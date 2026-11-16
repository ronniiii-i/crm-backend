import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { once } from 'node:events';
import {
  DEFAULT_WORKSPACE_FORMAT,
  WorkspaceFormatSettings,
  formatWorkspaceCurrency,
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceNumber,
} from '../../common/workspace-format';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveCurrencySymbol } from '../../tenant/tenant-settings.validation';
import { FieldMeta } from '../types/entity';
import {
  EntityQueryService,
  PlannedQuery,
} from '../services/entity-query.service';
import { ResolvedModuleAccess } from '../services/module-access.service';
import { CsvWriter, CsvValue } from './csv-writer';

const BATCH_SIZE = 500;
const DEFAULT_EXPORT_MAX_ROWS = 100_000;

/** Removed from the list query before it reaches `parseRecordsQuery`. */
const EXPORT_ONLY_PARAMS = new Set(['format', 'expand', 'includeSensitive']);

interface ExportColumn {
  label: string;
  kind: 'scalar' | 'relation' | 'custom';
  field?: FieldMeta;
  relation?: string;
  customKey?: string;
}

export interface ExportContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

function exportMaxRows(): number {
  const parsed = Number(process.env.EXPORT_MAX_ROWS);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_EXPORT_MAX_ROWS;
}

function firstValue(value: unknown): string | null {
  if (Array.isArray(value)) return firstValue(value[0]);
  if (typeof value === 'string') return value;
  return null;
}

function labelOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map(labelOf).filter(Boolean).join('; ');
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (typeof value !== 'object') return '';

  const row = value as Record<string, unknown>;
  for (const key of ['name', 'title', 'subject', 'invoiceNumber', 'label']) {
    const candidate = row[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }

  const first = typeof row.firstName === 'string' ? row.firstName : '';
  const last = typeof row.lastName === 'string' ? row.lastName : '';
  const fullName = `${first} ${last}`.trim();
  if (fullName) return fullName;

  for (const key of ['company', 'email', 'key']) {
    const candidate = row[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return '';
}

function humanizeEnum(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return '';
  }
  const text = String(value);
  if (text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function fileStamp(settings: WorkspaceFormatSettings): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(settings.timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return `${read('year')}${read('month')}${read('day')}-${read('hour')}${read('minute')}`;
}

/**
 * Streams the full filtered record set as CSV.
 *
 * Query planning is delegated to `EntityQueryService.plan` so the export uses
 * the same scope, soft-delete, filter, sort and search rules as the list
 * endpoint. Rows are read with Prisma cursor pagination in fixed-size batches
 * and written with backpressure-aware `res.write` calls.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: EntityQueryService,
  ) {}

  async stream(
    access: ResolvedModuleAccess,
    rawQuery: Record<string, unknown>,
    res: Response,
    context: ExportContext = {},
  ): Promise<void> {
    const descriptor = this.queries.requireEntity(access);
    if (!descriptor.exportable) {
      throw new BadRequestException({
        code: 'EXPORT_NOT_SUPPORTED',
        message: `${descriptor.label} cannot be exported.`,
      });
    }

    const format = firstValue(rawQuery.format) ?? 'csv';
    if (format !== 'csv') {
      throw new BadRequestException({
        code: 'UNSUPPORTED_EXPORT_FORMAT',
        message: 'Only CSV exports are supported.',
      });
    }

    const includeSensitive =
      access.actor.isTenantAdmin &&
      (firstValue(rawQuery.includeSensitive) === 'true' ||
        firstValue(rawQuery.includeSensitive) === '1');
    const expandCustomFields =
      firstValue(rawQuery.expand) === 'customFields' &&
      descriptor.select.includes('customFields');

    const strippedQuery: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawQuery)) {
      if (!EXPORT_ONLY_PARAMS.has(key)) strippedQuery[key] = value;
    }
    // The export always includes the relation labels it needs; honouring a
    // client `include` would only duplicate work.
    delete strippedQuery.include;

    const planned = await this.queries.plan(access, strippedQuery);
    const maxRows = exportMaxRows();

    await this.prisma.withTenant(access.actor.tenantId, async (tx) => {
      const total = await (tx as any)[planned.delegate].count({
        where: planned.where,
      });

      if (total > maxRows) {
        throw new PayloadTooLargeException({
          code: 'EXPORT_TOO_LARGE',
          message: `This export has ${total} rows; the limit is ${maxRows}. Narrow the filters and try again.`,
          limit: maxRows,
          total,
        });
      }

      const settings = await this.settings(tx, access.actor.tenantId);
      const baseColumns = this.columns(descriptor, { includeSensitive });
      const relationIncludes = new Set(
        baseColumns
          .map((column) => column.relation)
          .filter((relation): relation is string => Boolean(relation)),
      );
      const select = this.select(
        descriptor,
        relationIncludes,
        expandCustomFields,
      );
      const orderBy = this.orderBy(planned);

      const firstBatch = await (tx as any)[planned.delegate].findMany({
        where: planned.where,
        select,
        orderBy,
        take: BATCH_SIZE,
      });

      const columns = expandCustomFields
        ? [...baseColumns, ...this.customColumns(firstBatch)]
        : baseColumns;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${access.module.key}-${fileStamp(settings)}.csv"`,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Vary', 'Authorization');

      const writer = new CsvWriter();

      await this.writeWithBackpressure(
        res,
        writer.header(columns.map((column) => column.label)),
      );

      let written = 0;
      let batch = firstBatch;

      while (batch.length > 0) {
        if (res.destroyed || res.writableEnded) return;

        for (const row of batch) {
          await this.writeWithBackpressure(
            res,
            writer.row(
              columns.map((column) => this.cell(column, row, settings)),
            ),
          );
          written += 1;
        }

        if (batch.length < BATCH_SIZE) break;

        const cursor = batch[batch.length - 1].id as string;
        batch = await (tx as any)[planned.delegate].findMany({
          where: planned.where,
          select,
          orderBy,
          cursor: { id: cursor },
          skip: 1,
          take: BATCH_SIZE,
        });
      }

      res.end();

      await tx.auditLog.create({
        data: {
          tenantId: access.actor.tenantId,
          departmentId: access.module.departmentId ?? null,
          actorId: access.actor.id,
          action: 'EXPORT',
          entity: descriptor.key,
          entityId: null,
          moduleKey: access.module.key,
          requestId: context.requestId ?? null,
          after: {
            format: 'csv',
            rows: written,
            filters: strippedQuery,
          } as Prisma.InputJsonValue,
          ip: context.ip ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
    });
  }

  private async settings(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<WorkspaceFormatSettings> {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: {
        currency: true,
        currencySymbol: true,
        dateFormat: true,
        timeZone: true,
        locale: true,
        weekStartsOn: true,
      },
    });

    const currency = tenant?.currency ?? DEFAULT_WORKSPACE_FORMAT.currency;
    const locale = tenant?.locale ?? DEFAULT_WORKSPACE_FORMAT.locale;
    return {
      currency,
      currencySymbol:
        tenant?.currencySymbol ?? deriveCurrencySymbol(currency, locale),
      dateFormat: tenant?.dateFormat ?? DEFAULT_WORKSPACE_FORMAT.dateFormat,
      timeZone: tenant?.timeZone ?? DEFAULT_WORKSPACE_FORMAT.timeZone,
      locale,
      weekStartsOn:
        tenant?.weekStartsOn ?? DEFAULT_WORKSPACE_FORMAT.weekStartsOn,
    };
  }

  private columns(
    descriptor: PlannedQuery['descriptor'],
    options: { includeSensitive: boolean },
  ): ExportColumn[] {
    const columns: ExportColumn[] = [];
    const seen = new Set<string>();
    const relationColumns = new Set([
      descriptor.displayField,
      ...(descriptor.secondaryDisplayFields ?? []),
    ]);

    for (const field of descriptor.fields) {
      if (field.name === 'id') {
        if (descriptor.key === 'audit_logs' && options.includeSensitive) {
          columns.push({
            label: 'Record id',
            kind: 'scalar',
            field,
          });
        }
        continue;
      }

      if (field.sensitive && !options.includeSensitive) continue;

      if (field.relation) {
        if (!relationColumns.has(field.name)) continue;
        if (!descriptor.includeMap[field.name]) continue;
        if (seen.has(field.name)) continue;
        seen.add(field.name);
        columns.push({
          label: field.label,
          kind: 'relation',
          relation: field.name,
        });
        continue;
      }

      if (field.reference?.relationField) {
        const relation = field.reference.relationField;
        if (!descriptor.includeMap[relation]) continue;
        if (seen.has(relation)) continue;
        seen.add(relation);
        columns.push({
          label: field.label,
          kind: 'relation',
          relation,
        });
        continue;
      }

      if (field.type === 'json') {
        // `customFields` is expanded into `custom.<key>` columns, and other
        // JSON blobs (before/after) are only useful in the admin drawer.
        continue;
      }

      if (seen.has(field.name)) continue;
      seen.add(field.name);
      columns.push({ label: field.label, kind: 'scalar', field });
    }

    return columns;
  }

  private customColumns(rows: Array<Record<string, unknown>>): ExportColumn[] {
    const keys = new Set<string>();
    for (const row of rows) {
      const custom = row.customFields;
      if (!custom || typeof custom !== 'object' || Array.isArray(custom)) {
        continue;
      }
      for (const key of Object.keys(custom as Record<string, unknown>)) {
        keys.add(key);
      }
    }

    return Array.from(keys)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => ({
        label: `Custom: ${key}`,
        kind: 'custom' as const,
        customKey: key,
      }));
  }

  private select(
    descriptor: PlannedQuery['descriptor'],
    relations: Set<string>,
    expandCustomFields: boolean,
  ): Record<string, unknown> {
    const select: Record<string, unknown> = {
      ...Object.fromEntries(descriptor.select.map((field) => [field, true])),
    };
    for (const relation of relations) {
      const include = descriptor.includeMap[relation];
      if (include) select[relation] = include;
    }
    if (expandCustomFields) select.customFields = true;
    return select;
  }

  private orderBy(planned: PlannedQuery): Record<string, unknown>[] {
    const primary = planned.orderBy;
    if (Object.prototype.hasOwnProperty.call(primary, 'id')) return [primary];
    return [primary, { id: 'asc' }];
  }

  private cell(
    column: ExportColumn,
    row: Record<string, any>,
    settings: WorkspaceFormatSettings,
  ): CsvValue {
    if (column.kind === 'relation') {
      return labelOf(row[column.relation!]);
    }

    if (column.kind === 'custom') {
      const custom = row.customFields;
      if (!custom || typeof custom !== 'object') return '';
      return this.value(custom[column.customKey!], 'text', settings);
    }

    const field = column.field!;
    return this.value(row[field.name], field.type, settings);
  }

  private value(
    raw: unknown,
    type: FieldMeta['type'],
    settings: WorkspaceFormatSettings,
  ): CsvValue {
    if (raw === null || raw === undefined) return '';

    switch (type) {
      case 'currency':
        return formatWorkspaceCurrency(raw as number | string, settings, '');
      case 'number':
        return formatWorkspaceNumber(raw as number | string, settings, '');
      case 'date':
        if (raw instanceof Date) {
          return formatWorkspaceDateTime(raw, settings, '');
        }
        if (typeof raw === 'string') {
          return /^\d{4}-\d{2}-\d{2}$/.test(raw)
            ? formatWorkspaceDate(raw, settings, '')
            : formatWorkspaceDateTime(raw, settings, '');
        }
        return formatWorkspaceDateTime(raw as number | string, settings, '');
      case 'boolean':
        return raw ? 'Yes' : 'No';
      case 'enum':
        return humanizeEnum(raw);
      case 'string[]':
        return Array.isArray(raw)
          ? raw.join('; ')
          : typeof raw === 'string' || typeof raw === 'number'
            ? String(raw)
            : '';
      case 'json':
        return JSON.stringify(raw);
      default:
        if (typeof raw === 'string' || typeof raw === 'number') return raw;
        return typeof raw === 'boolean' ? String(raw) : '';
    }
  }

  private async writeWithBackpressure(
    res: Response,
    chunk: string,
  ): Promise<void> {
    if (!chunk) return;
    if (res.write(chunk) === false) {
      await once(res, 'drain');
    }
  }
}

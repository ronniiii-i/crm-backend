import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityDescriptor, ScopeName, WhereInput } from '../types/entity';
import {
  AggregateBody,
  AggregateWidgetInput,
  AggregateValidationError,
  DASHBOARD_ENTITIES,
  DashboardEntity,
  GROUPABLE_FIELDS,
  TIMEFRAME_FIELDS,
  TimeframeName,
  parseAggregateBody,
} from '../dto/aggregate.dto';
import { FilterClause } from '../dto/records-query';
import { buildFilterCondition } from './entity-query.service';
import { EntityRegistryService } from './entity-registry.service';
import { ResolvedModuleAccess } from './module-access.service';
import { ScopeFilterService } from './scope-filter.service';

export interface WidgetResult {
  id: string;
  value?: number | null;
  series?: Array<{ key: string | null; value: number | null }>;
  error?: { code: string; message: string };
}

export interface AggregateResponse {
  results: WidgetResult[];
  generatedAt: string;
  scope: ScopeName;
}

const MAX_WIDGETS = 12;

/**
 * Batch dashboard aggregation.
 *
 * Every widget is validated against the entity allowlist and executed with
 * the same data-scope predicate as the records endpoint. A single bad widget
 * is returned as `{ id, error }` instead of failing the batch.
 */
@Injectable()
export class AggregationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: EntityRegistryService,
    private readonly scopes: ScopeFilterService,
  ) {}

  async run(
    access: ResolvedModuleAccess,
    body: unknown,
    now: Date = new Date(),
  ): Promise<AggregateResponse> {
    let parsed: AggregateBody;
    try {
      parsed = parseAggregateBody(body);
    } catch (error) {
      if (error instanceof AggregateValidationError) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }

    const widgetInputs = parsed.widgets.slice(0, MAX_WIDGETS);

    const prepared: Array<
      | { id: string; error: WidgetResult['error'] }
      | {
          id: string;
          descriptor: EntityDescriptor;
          widget: AggregateWidgetInput;
          where: WhereInput;
        }
    > = [];

    for (const widget of widgetInputs) {
      try {
        const descriptor = this.descriptorFor(widget.entity);
        const where = await this.buildWhere(access, descriptor, widget, now);
        prepared.push({ id: widget.id, descriptor, widget, where });
      } catch (error) {
        prepared.push({ id: widget.id, error: toWidgetError(error) });
      }
    }

    const results = await this.prisma.withTenant(
      access.actor.tenantId,
      async (tx) => {
        const output: WidgetResult[] = [];

        for (const entry of prepared) {
          if ('error' in entry) {
            output.push({ id: entry.id, error: entry.error });
            continue;
          }

          try {
            output.push(
              await this.execute(
                tx,
                entry.descriptor,
                entry.widget,
                entry.where,
              ),
            );
          } catch (error) {
            output.push({ id: entry.id, error: toWidgetError(error) });
          }
        }

        return output;
      },
    );

    return {
      results,
      generatedAt: new Date().toISOString(),
      scope: access.scope,
    };
  }

  private descriptorFor(entity: DashboardEntity): EntityDescriptor {
    const descriptor = this.registry.get(entity);
    if (!descriptor) {
      throw new BadRequestException({
        code: 'INVALID_WIDGET_ENTITY',
        message: `Entity "${entity}" is not available for dashboards.`,
      });
    }
    return descriptor;
  }

  private async buildWhere(
    access: ResolvedModuleAccess,
    descriptor: EntityDescriptor,
    widget: AggregateWidgetInput,
    now: Date,
  ): Promise<WhereInput> {
    this.assertAggregation(descriptor, widget);

    const scope = await this.scopes.build(
      descriptor,
      access.actor,
      access.module.dataScope,
    );

    const clauseFilters = widget.filters.map((filter) =>
      buildFilterCondition(descriptor, {
        field: filter.field,
        op: filter.op ?? 'eq',
        value: filter.value,
      } as FilterClause),
    );

    const timeFilter = this.timeframeCondition(
      descriptor,
      widget.timeframe,
      now,
    );

    return {
      AND: [scope.where, ...clauseFilters, ...(timeFilter ? [timeFilter] : [])],
    };
  }

  private assertAggregation(
    descriptor: EntityDescriptor,
    widget: AggregateWidgetInput,
  ): void {
    if (widget.groupBy) {
      const groupable =
        descriptor.groupableFields.includes(widget.groupBy) &&
        (GROUPABLE_FIELDS as readonly string[]).includes(widget.groupBy);
      if (!groupable) {
        throw new BadRequestException({
          code: 'INVALID_GROUP_BY',
          message: `Widget "${widget.id}" cannot group ${descriptor.label} by "${widget.groupBy}".`,
        });
      }
    }

    if (widget.aggregation === 'COUNT') {
      if (widget.field) {
        this.assertField(descriptor, widget.id, widget.field, [
          'number',
          'currency',
          'date',
          'text',
          'email',
          'enum',
          'boolean',
        ]);
      }
      return;
    }

    const field = widget.field as string;
    if (widget.aggregation === 'SUM' || widget.aggregation === 'AVG') {
      this.assertField(descriptor, widget.id, field, ['number', 'currency']);
      return;
    }

    // MIN/MAX support numeric and date columns.
    this.assertField(descriptor, widget.id, field, [
      'number',
      'currency',
      'date',
    ]);
  }

  private assertField(
    descriptor: EntityDescriptor,
    widgetId: string,
    fieldName: string,
    types: string[],
  ): void {
    const field = descriptor.fields.find(
      (entry) => entry.name === fieldName && !entry.relation,
    );

    if (!field || !types.includes(field.type)) {
      throw new BadRequestException({
        code: 'INVALID_AGGREGATION_FIELD',
        message: `Widget "${widgetId}" cannot aggregate "${fieldName}" on ${descriptor.label}.`,
      });
    }
  }

  private timeframeCondition(
    descriptor: EntityDescriptor,
    timeframe: TimeframeName,
    now: Date,
  ): WhereInput | null {
    if (timeframe === 'ALL') return null;

    const dateField = descriptor.dateFields.includes(
      TIMEFRAME_FIELDS[descriptor.key as DashboardEntity] ?? '',
    )
      ? TIMEFRAME_FIELDS[descriptor.key as DashboardEntity]
      : descriptor.dateFields.includes('createdAt')
        ? 'createdAt'
        : descriptor.dateFields[0];

    if (!dateField) return null;

    return { [dateField]: { gte: timeframeStart(timeframe, now) } };
  }

  private async execute(
    tx: Prisma.TransactionClient,
    descriptor: EntityDescriptor,
    widget: AggregateWidgetInput,
    where: WhereInput,
  ): Promise<WidgetResult> {
    const delegate = (tx as any)[descriptor.delegate];
    const field = widget.field;

    if (widget.groupBy) {
      const rows = await delegate.groupBy({
        by: [widget.groupBy],
        where,
        ...aggregationArgs(widget, field),
        orderBy: { [widget.groupBy]: 'asc' },
      });

      return {
        id: widget.id,
        series: rows.map((row: Record<string, unknown>) => ({
          key: (row[widget.groupBy as string] as string | null) ?? null,
          value: extractValue(row, widget),
        })),
      };
    }

    if (widget.aggregation === 'COUNT') {
      const value = await delegate.count({ where });
      return { id: widget.id, value };
    }

    const row = await delegate.aggregate({
      where,
      ...aggregationArgs(widget, field),
    });

    return { id: widget.id, value: extractValue(row, widget) };
  }
}

/** Date lower bound for a timeframe, or `now` minus the rolling window. */
export function timeframeStart(timeframe: TimeframeName, now: Date): Date {
  const start = new Date(now.getTime());

  switch (timeframe) {
    case 'LAST_7_DAYS':
      start.setUTCDate(start.getUTCDate() - 7);
      return start;
    case 'LAST_30_DAYS':
      start.setUTCDate(start.getUTCDate() - 30);
      return start;
    case 'LAST_90_DAYS':
      start.setUTCDate(start.getUTCDate() - 90);
      return start;
    case 'MTD':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    case 'QTD':
      return new Date(
        Date.UTC(
          now.getUTCFullYear(),
          Math.floor(now.getUTCMonth() / 3) * 3,
          1,
        ),
      );
    case 'YTD':
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    case 'ALL':
      return new Date(0);
  }
}

function aggregationArgs(
  widget: AggregateWidgetInput,
  field: string | null,
): Record<string, unknown> {
  switch (widget.aggregation) {
    case 'SUM':
      return { _sum: { [field as string]: true } };
    case 'AVG':
      return { _avg: { [field as string]: true } };
    case 'MIN':
      return { _min: { [field as string]: true } };
    case 'MAX':
      return { _max: { [field as string]: true } };
    case 'COUNT':
      return { _count: { _all: true } };
  }
}

function extractValue(
  row: Record<string, unknown>,
  widget: AggregateWidgetInput,
): number | null {
  if (widget.aggregation === 'COUNT') {
    const count = row._count as
      | { _all?: number; [key: string]: number | undefined }
      | number
      | undefined;
    if (typeof count === 'number') return count;
    return count?.[widget.field ?? '_all'] ?? count?._all ?? null;
  }

  if (widget.aggregation === 'SUM') {
    return toNumber(
      (row._sum as Record<string, unknown>)?.[widget.field as string],
    );
  }
  if (widget.aggregation === 'AVG') {
    return toNumber(
      (row._avg as Record<string, unknown>)?.[widget.field as string],
    );
  }
  if (widget.aggregation === 'MIN') {
    return toNumber(
      (row._min as Record<string, unknown>)?.[widget.field as string],
    );
  }
  return toNumber(
    (row._max as Record<string, unknown>)?.[widget.field as string],
  );
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toWidgetError(error: unknown): { code: string; message: string } {
  if (error instanceof AggregateValidationError) {
    return { code: error.code, message: error.message };
  }

  const response = (error as { response?: unknown })?.response;
  if (response && typeof response === 'object') {
    const typed = response as { code?: string; message?: string | string[] };
    if (typed.code) {
      return {
        code: typed.code,
        message: Array.isArray(typed.message)
          ? typed.message.join(', ')
          : String(typed.message ?? typed.code),
      };
    }
  }

  if (error instanceof Error) {
    return { code: 'AGGREGATION_FAILED', message: error.message };
  }

  return { code: 'AGGREGATION_FAILED', message: 'Aggregation failed.' };
}

export { DASHBOARD_ENTITIES };

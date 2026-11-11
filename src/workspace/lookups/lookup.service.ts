import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityRegistryService } from '../services/entity-registry.service';
import { ResolvedModuleAccess } from '../services/module-access.service';
import { ScopeFilterService } from '../services/scope-filter.service';
import { FieldReference } from '../types/entity';
import { LOOKUP_SOURCES, LookupRow } from './lookup-sources';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_IDS = 50;
const MAX_QUERY_LENGTH = 80;

export interface LookupOption {
  value: string;
  label: string;
  secondary?: string | null;
  meta?: Record<string, unknown>;
}

export interface LookupResult {
  field: string;
  options: LookupOption[];
}

function firstString(value: unknown): string {
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === 'string' ? value : '';
}

/** Clamp a query-string number to the lookup limits. */
function parseLimit(value: unknown): number {
  const raw = firstString(value).trim();
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

/**
 * Resolve relational dropdown options for a module's scalar FK field.
 *
 * The field name comes from the client; the source delegate, tenant predicate,
 * select shape and search columns are all server-side constants. A cross-tenant
 * id supplied through `ids` simply falls outside the tenant transaction and is
 * dropped.
 */
@Injectable()
export class LookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: EntityRegistryService,
    private readonly scopes: ScopeFilterService,
  ) {}

  async lookup(
    access: ResolvedModuleAccess,
    field: string,
    query: Record<string, unknown>,
  ): Promise<LookupResult> {
    const descriptor = access.entity;
    if (!descriptor) {
      throw new BadRequestException({
        code: 'MODULE_HAS_NO_ENTITY',
        message: `Module ${access.module.key} does not expose business records.`,
      });
    }

    const fieldMeta = descriptor.fields.find((entry) => entry.name === field);
    if (!fieldMeta) {
      throw new BadRequestException({
        code: 'UNKNOWN_LOOKUP_FIELD',
        message: `Field "${field}" is not available for ${descriptor.label}.`,
      });
    }

    const reference = fieldMeta.reference;
    if (!reference) {
      throw new BadRequestException({
        code: 'FIELD_NOT_REFERENCE',
        message: `Field "${field}" does not reference another entity.`,
      });
    }

    const source = LOOKUP_SOURCES[reference.entity];
    if (!source) {
      throw new BadRequestException({
        code: 'UNKNOWN_LOOKUP_SOURCE',
        message: `No lookup source is configured for "${reference.entity}".`,
      });
    }

    const term = firstString(query.q).trim().slice(0, MAX_QUERY_LENGTH);
    const ids = this.parseIds(query.ids);
    const limit = parseLimit(query.limit);

    const clauses: Record<string, unknown>[] = [
      { tenantId: access.actor.tenantId },
    ];
    if (source.filter) clauses.push(source.filter);
    if (reference.filter) clauses.push(reference.filter);

    if (source.scope !== 'TENANT') {
      const sourceDescriptor = this.registry.get(reference.entity);
      if (!sourceDescriptor) {
        throw new BadRequestException({
          code: 'UNKNOWN_LOOKUP_SOURCE',
          message: `No descriptor is configured for "${reference.entity}".`,
        });
      }
      const scope = await this.scopes.build(sourceDescriptor, access.actor);
      clauses.push(scope.where);
    }

    const matches: Record<string, unknown>[] = [];
    if (term) {
      matches.push(...this.searchClauses(source.searchFields, term));
    }
    if (ids.length > 0) {
      matches.push({ id: { in: ids } });
    }
    if (matches.length > 0) {
      clauses.push(matches.length === 1 ? matches[0] : { OR: matches });
    }

    const take = Math.min(MAX_LIMIT, Math.max(limit, ids.length));

    const rows = await this.prisma.withTenant(access.actor.tenantId, (tx) =>
      (tx as any)[source.delegate].findMany({
        where: { AND: clauses },
        select: source.select,
        orderBy: { [source.sortField]: 'asc' },
        take,
      }),
    );

    return {
      field,
      options: (rows as LookupRow[]).map((row) =>
        this.toOption(row, reference),
      ),
    };
  }

  private searchClauses(
    fields: string[],
    term: string,
  ): Record<string, unknown>[] {
    return fields.map((field) => ({
      [field]: { contains: term, mode: 'insensitive' },
    }));
  }

  private parseIds(value: unknown): string[] {
    const raw = Array.isArray(value) ? value.join(',') : firstString(value);
    return Array.from(
      new Set(
        raw
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ).slice(0, MAX_IDS);
  }

  private toOption(row: LookupRow, reference: FieldReference): LookupOption {
    const source = LOOKUP_SOURCES[reference.entity];
    const secondary = source.secondary?.(row) ?? null;
    const meta = source.meta?.(row);

    return {
      value: String(row.id),
      label: source.label(row),
      ...(secondary ? { secondary } : {}),
      ...(meta ? { meta } : {}),
    };
  }
}

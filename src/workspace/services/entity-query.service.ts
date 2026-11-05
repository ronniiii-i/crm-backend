import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EntityDescriptor,
  FieldMeta,
  ScopeName,
  WhereInput,
} from '../types/entity';
import { resolveField } from '../entities/field-resolver';
import { FilterClause, parseRecordsQuery } from '../dto/records-query';
import { ScopeFilterService } from './scope-filter.service';
import { ResolvedModuleAccess } from './module-access.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ListResult {
  data: unknown[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  scope: ScopeName;
}

/**
 * Builds allowlisted, scope-filtered read queries for workspace records.
 *
 * The delegate, select shape, sortable fields, filterable fields and includes
 * all come from the server-side descriptor — never from the request.
 */
@Injectable()
export class EntityQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ScopeFilterService,
  ) {}

  async list(
    access: ResolvedModuleAccess,
    rawQuery: Record<string, unknown>,
  ): Promise<ListResult> {
    const descriptor = this.requireEntity(access);
    const query = parseRecordsQuery(rawQuery);
    const scope = await this.scopes.build(
      descriptor,
      access.actor,
      access.module.dataScope,
    );

    const filterClauses = query.filters.map((clause) =>
      this.buildClause(descriptor, clause),
    );

    const searchWhere = this.buildSearch(descriptor, query.search);
    const where: WhereInput = {
      AND: [
        scope.where,
        ...filterClauses,
        ...(searchWhere ? [searchWhere] : []),
      ],
    };

    const includes = this.buildIncludes(descriptor, query.include);
    const select = {
      ...Object.fromEntries(descriptor.select.map((field) => [field, true])),
      ...includes,
    };

    const orderBy = query.sort
      ? this.buildOrderBy(descriptor, query.sort.field, query.sort.dir)
      : { [descriptor.defaultSort.field]: descriptor.defaultSort.dir };

    const delegate = this.delegate(access, descriptor);

    return this.prisma.withTenant(access.actor.tenantId, async (tx) => {
      const total = await (tx as any)[delegate].count({ where });
      const rows = await (tx as any)[delegate].findMany({
        where,
        select,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });

      return {
        data: rows,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        },
        scope: scope.scope,
      };
    });
  }

  async getOne(access: ResolvedModuleAccess, id: string): Promise<unknown> {
    const descriptor = this.requireEntity(access);
    if (!UUID_PATTERN.test(id)) {
      throw new NotFoundException({
        code: 'RECORD_NOT_FOUND',
        message: `${descriptor.label} record was not found.`,
      });
    }

    const scope = await this.scopes.build(
      descriptor,
      access.actor,
      access.module.dataScope,
    );

    const select = {
      ...Object.fromEntries(descriptor.select.map((field) => [field, true])),
      ...descriptor.includeMap,
    };

    const delegate = this.delegate(access, descriptor);

    const row = await this.prisma.withTenant(access.actor.tenantId, (tx) =>
      (tx as any)[delegate].findFirst({
        where: { AND: [scope.where, { id }] },
        select,
      }),
    );

    if (!row) {
      throw new NotFoundException({
        code: 'RECORD_NOT_FOUND',
        message: `${descriptor.label} record was not found.`,
      });
    }

    return row;
  }

  requireEntity(access: ResolvedModuleAccess): EntityDescriptor {
    if (!access.entity) {
      throw new BadRequestException({
        code: 'MODULE_HAS_NO_ENTITY',
        message: `Module ${access.module.key} does not expose business records.`,
      });
    }
    return access.entity;
  }

  private delegate(
    access: ResolvedModuleAccess,
    descriptor: EntityDescriptor,
  ): string {
    void access;
    return descriptor.delegate;
  }

  private buildIncludes(
    descriptor: EntityDescriptor,
    requested: string[],
  ): Record<string, unknown> {
    const includes: Record<string, unknown> = {};

    for (const relationName of requested) {
      const include = descriptor.includeMap[relationName];
      if (!include) {
        throw new BadRequestException({
          code: 'UNKNOWN_INCLUDE',
          message: `Include "${relationName}" is not allowed for ${descriptor.label}.`,
        });
      }
      includes[relationName] = include;
    }

    return includes;
  }

  private buildOrderBy(
    descriptor: EntityDescriptor,
    fieldPath: string,
    dir: 'asc' | 'desc',
  ): Record<string, unknown> {
    const resolved = resolveField(descriptor, fieldPath);
    if (!resolved) {
      throw new BadRequestException({
        code: 'UNKNOWN_SORT_FIELD',
        message: `Cannot sort ${descriptor.label} by "${fieldPath}".`,
      });
    }

    if (resolved.kind === 'scalar') {
      if (!resolved.field.sortable) {
        throw new BadRequestException({
          code: 'NOT_SORTABLE',
          message: `Field "${fieldPath}" is not sortable.`,
        });
      }
      return { [resolved.field.name]: dir };
    }

    if (resolved.kind === 'nested') {
      return { [resolved.relation]: { [resolved.leaf]: dir } };
    }

    throw new BadRequestException({
      code: 'NOT_SORTABLE',
      message: `Field "${fieldPath}" is not sortable.`,
    });
  }

  private buildSearch(
    descriptor: EntityDescriptor,
    term: string | null,
  ): WhereInput | null {
    if (!term) return null;

    const fields = descriptor.searchFields.filter((name) =>
      descriptor.select.includes(name),
    );
    if (fields.length === 0) return null;

    return {
      OR: fields.map((field) => ({
        [field]: { contains: term, mode: 'insensitive' },
      })),
    };
  }

  private buildClause(
    descriptor: EntityDescriptor,
    clause: FilterClause,
  ): WhereInput {
    return buildFilterCondition(descriptor, clause);
  }
}

/**
 * Convert one validated filter clause into a Prisma `where` fragment.
 *
 * Shared by the records endpoint and the dashboard aggregation endpoint so
 * both enforce the same field allowlist and coercion rules.
 */
export function buildFilterCondition(
  descriptor: EntityDescriptor,
  clause: FilterClause,
): WhereInput {
  const resolved = resolveField(descriptor, clause.field);
  if (!resolved) {
    throw new BadRequestException({
      code: 'UNKNOWN_FILTER_FIELD',
      message: `Cannot filter ${descriptor.label} by "${clause.field}".`,
    });
  }

  if (resolved.kind === 'custom') {
    return {
      customFields: {
        path: [resolved.path],
        ...(jsonCondition(clause.op, parseJsonScalar(clause.value)) as Record<
          string,
          unknown
        >),
      },
    };
  }

  if (resolved.kind === 'tags') {
    if (clause.op === 'eq') {
      return { tags: { has: String(clause.value) } };
    }
    if (clause.op === 'in') {
      const values = Array.isArray(clause.value)
        ? clause.value.map(String)
        : [String(clause.value)];
      return { tags: { hasSome: values } };
    }
    throw new BadRequestException({
      code: 'UNSUPPORTED_FILTER',
      message: `Operator "${clause.op}" is not supported for tags.`,
    });
  }

  if (resolved.kind === 'nested') {
    return {
      [resolved.relation]: {
        [resolved.leaf]: condition(
          clause.op,
          coerceLoose(clause.op, clause.value),
        ),
      },
    };
  }

  const field = resolved.field;
  if (!field.filterable) {
    throw new BadRequestException({
      code: 'NOT_FILTERABLE',
      message: `Field "${field.name}" is not filterable.`,
    });
  }

  return {
    [field.name]: condition(clause.op, coerceValue(field, clause)),
  };
}

function condition(op: FilterClause['op'], value: unknown): unknown {
  switch (op) {
    case 'eq':
      return value;
    case 'neq':
      return { not: value };
    case 'gt':
      return { gt: value };
    case 'gte':
      return { gte: value };
    case 'lt':
      return { lt: value };
    case 'lte':
      return { lte: value };
    case 'in':
      return { in: Array.isArray(value) ? value : [value] };
    case 'contains':
      return { contains: value, mode: 'insensitive' };
    case 'startsWith':
      return { startsWith: value, mode: 'insensitive' };
    case 'endsWith':
      return { endsWith: value, mode: 'insensitive' };
    case 'isNull':
      return value === true ? { equals: null } : { not: null };
  }
}

function jsonCondition(op: FilterClause['op'], value: unknown): unknown {
  switch (op) {
    case 'eq':
      return { equals: value };
    case 'neq':
      return { not: value };
    case 'gt':
      return { gt: value };
    case 'gte':
      return { gte: value };
    case 'lt':
      return { lt: value };
    case 'lte':
      return { lte: value };
    case 'in':
      return { in: Array.isArray(value) ? value : [value] };
    case 'contains':
      return { string_contains: String(value) };
    case 'startsWith':
      return { string_starts_with: String(value) };
    case 'endsWith':
      return { string_ends_with: String(value) };
    case 'isNull':
      return value === true ? { equals: null } : { not: null };
  }
}

function coerceValue(field: FieldMeta, clause: FilterClause): unknown {
  if (clause.op === 'isNull') {
    return clause.value === true;
  }

  if (clause.op === 'in') {
    const values = Array.isArray(clause.value) ? clause.value : [clause.value];
    return values.map((value) => coerceScalar(field, value));
  }

  if (
    clause.op === 'contains' ||
    clause.op === 'startsWith' ||
    clause.op === 'endsWith'
  ) {
    if (field.type !== 'text' && field.type !== 'email') {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILTER',
        message: `Operator "${clause.op}" requires a text field.`,
      });
    }
  }

  return coerceScalar(field, clause.value);
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function coerceScalar(field: FieldMeta, value: unknown): unknown {
  if (value === null || value === undefined) return value;

  switch (field.type) {
    case 'number':
    case 'currency': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new BadRequestException({
          code: 'INVALID_FILTER_VALUE',
          message: `Field "${field.name}" requires a number.`,
        });
      }
      return parsed;
    }
    case 'date': {
      const parsed = new Date(asText(value));
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException({
          code: 'INVALID_FILTER_VALUE',
          message: `Field "${field.name}" requires an ISO date.`,
        });
      }
      return parsed;
    }
    case 'boolean':
      return value === true || value === 'true' || value === '1';
    case 'enum': {
      const stringValue = asText(value);
      if (field.enumValues && !field.enumValues.includes(stringValue)) {
        throw new BadRequestException({
          code: 'INVALID_FILTER_VALUE',
          message: `Field "${field.name}" must be one of: ${field.enumValues.join(', ')}.`,
        });
      }
      return stringValue;
    }
    default:
      return asText(value);
  }
}

function coerceLoose(op: FilterClause['op'], value: unknown): unknown {
  if (op === 'isNull') return value === true;
  if (Array.isArray(value)) return value.map(String);
  return String(value);
}

function parseJsonScalar(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

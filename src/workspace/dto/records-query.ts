import { BadRequestException } from '@nestjs/common';

/** Supported filter operators. Anything else is rejected with `400`. */
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'isNull';

const OPERATORS = new Set<FilterOperator>([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'contains',
  'startsWith',
  'endsWith',
  'isNull',
]);

const TOP_LEVEL_KEYS = new Set([
  'search',
  'page',
  'pageSize',
  'sort',
  'include',
]);

export interface FilterClause {
  field: string;
  op: FilterOperator;
  value: unknown;
}

export interface RecordsQuery {
  search: string | null;
  page: number;
  pageSize: number;
  sort: { field: string; dir: 'asc' | 'desc' } | null;
  include: string[];
  filters: FilterClause[];
}

/**
 * Parse the records query string into a structured, bounded shape.
 *
 * Accepts both Express' simple parser (`filter[status]=Paid`) and an extended
 * parser (`filter: { status: 'Paid' }`) so the API behaves the same behind
 * either configuration.
 */
export function parseRecordsQuery(raw: Record<string, unknown>): RecordsQuery {
  rejectUnknownKeys(raw);

  const page = positiveInt(raw.page, 1, 'page');
  const pageSize = positiveInt(raw.pageSize, 25, 'pageSize');
  if (pageSize > 100) {
    throw invalid('pageSize must not exceed 100.');
  }

  const search = singleString(raw.search);
  if (search && search.length > 200) {
    throw invalid('search must be 200 characters or fewer.');
  }

  return {
    search: search ? search.trim() : null,
    page,
    pageSize,
    sort: parseSort(singleString(raw.sort)),
    include: parseInclude(singleString(raw.include)),
    filters: parseFilters(raw),
  };
}

function rejectUnknownKeys(raw: Record<string, unknown>): void {
  const unknown = Object.keys(raw).filter(
    (key) => !TOP_LEVEL_KEYS.has(key) && !key.startsWith('filter['),
  );

  if (unknown.length > 0) {
    throw invalid(`Unknown query parameter(s): ${unknown.join(', ')}.`);
  }
}

function positiveInt(value: unknown, fallback: number, name: string): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(singleString(value));
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw invalid(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseSort(value: string | null): RecordsQuery['sort'] {
  if (!value) return null;
  const [field, dir = 'desc', extra] = value.split(':');
  if (!field || extra !== undefined) {
    throw invalid('sort must use the form field:asc or field:desc.');
  }
  if (dir !== 'asc' && dir !== 'desc') {
    throw invalid('sort direction must be asc or desc.');
  }
  return { field, dir };
}

function parseInclude(value: string | null): string[] {
  if (!value) return [];
  const include = Array.from(
    new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
  if (include.length > 5) {
    throw invalid('At most 5 includes may be requested.');
  }
  return include;
}

function parseFilters(raw: Record<string, unknown>): FilterClause[] {
  const filters: FilterClause[] = [];

  const structured = raw.filter;
  if (
    structured &&
    typeof structured === 'object' &&
    !Array.isArray(structured)
  ) {
    for (const [field, condition] of Object.entries(
      structured as Record<string, unknown>,
    )) {
      if (
        condition &&
        typeof condition === 'object' &&
        !Array.isArray(condition)
      ) {
        for (const [op, value] of Object.entries(
          condition as Record<string, unknown>,
        )) {
          filters.push(clause(field, op, value));
        }
      } else {
        filters.push(clause(field, 'eq', condition));
      }
    }
  }

  const literal = /^filter\[([^\]]+)\](?:\[([a-zA-Z]+)\])?$/;

  for (const [key, value] of Object.entries(raw)) {
    const match = literal.exec(key);
    if (!match) continue;
    filters.push(clause(match[1], match[2] ?? 'eq', value));
  }

  if (filters.length > 20) {
    throw invalid('At most 20 filters may be supplied.');
  }

  return filters;
}

function clause(field: string, op: string, value: unknown): FilterClause {
  if (!OPERATORS.has(op as FilterOperator)) {
    throw invalid(`Unsupported filter operator "${op}".`);
  }

  let parsedValue = value;
  if (op === 'in') {
    if (Array.isArray(value)) {
      parsedValue = value;
    } else {
      parsedValue = singleString(value)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  } else if (op === 'isNull') {
    parsedValue =
      value === true || value === 'true' || value === '1' || value === '';
  } else {
    parsedValue = singleString(value);
  }

  return { field, op: op as FilterOperator, value: parsedValue };
}

function singleString(value: unknown): string {
  if (Array.isArray(value)) {
    return singleString(value[0]);
  }
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: 'INVALID_QUERY', message });
}

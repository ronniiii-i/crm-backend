import { LookupEntityKey, ScopeName } from '../types/entity';

/**
 * Server-side lookup source registry.
 *
 * A request can name a field only; the delegate, select shape, filters and
 * search columns are resolved here. Adding a key to this map is the only way
 * to make a lookup source reachable from the API.
 */

export type LookupRow = Record<string, any>;

export interface LookupSource {
  delegate: string;
  select: Record<string, boolean>;
  /** Columns matched by the `q` search term. */
  searchFields: string[];
  /** Column used to order options alphabetically. */
  sortField: string;
  label: (row: LookupRow) => string;
  secondary?: (row: LookupRow) => string | null;
  meta?: (row: LookupRow) => Record<string, unknown>;
  /** Always-applied server-side predicate. */
  filter?: Record<string, unknown>;
  /** Narrowest data scope this source supports. */
  scope: ScopeName;
}

function optional(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

export const LOOKUP_SOURCES: Record<LookupEntityKey, LookupSource> = {
  users: {
    delegate: 'user',
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      departmentId: true,
    },
    searchFields: ['name', 'email'],
    sortField: 'name',
    label: (row) => optional(row.name) ?? optional(row.email) ?? 'User',
    secondary: (row) => optional(row.email),
    meta: (row) => ({ status: row.status ?? null }),
    filter: { status: { notIn: ['SUSPENDED', 'FIRED'] } },
    scope: 'TENANT',
  },

  projects: {
    delegate: 'project',
    select: { id: true, name: true, status: true },
    searchFields: ['name', 'status'],
    sortField: 'name',
    label: (row) => optional(row.name) ?? 'Project',
    secondary: (row) => optional(row.status),
    meta: (row) => ({ status: row.status ?? null }),
    filter: { deletedAt: null },
    scope: 'TENANT',
  },

  departments: {
    delegate: 'department',
    select: { id: true, key: true, name: true },
    searchFields: ['name', 'key'],
    sortField: 'name',
    label: (row) => optional(row.name) ?? optional(row.key) ?? 'Department',
    secondary: (row) => optional(row.key),
    meta: (row) => ({ key: row.key ?? null }),
    scope: 'TENANT',
  },

  contacts: {
    delegate: 'contact',
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      email: true,
    },
    searchFields: ['firstName', 'lastName', 'company', 'email'],
    sortField: 'firstName',
    label: (row) =>
      `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || 'Contact',
    secondary: (row) => optional(row.company) ?? optional(row.email),
    meta: (row) => ({
      company: row.company ?? null,
      email: row.email ?? null,
    }),
    filter: { deletedAt: null },
    scope: 'TENANT',
  },
};

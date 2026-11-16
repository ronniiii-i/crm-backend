/**
 * In-memory Prisma double for the workspace API tests.
 *
 * It emulates the subset of Prisma used by `src/workspace/**`:
 * `withTenant` fail-closed scoping, `where` matching (AND/OR/nested
 * relations/in/gte/contains/JSON path), sorting, pagination, aggregates,
 * groupBy and CRUD. Fixtures attach relations directly on rows so nested
 * predicates can be evaluated without joins.
 */

import { randomUUID } from 'node:crypto';

export type Row = Record<string, any>;

export interface WorkspaceState {
  tenants: Row[];
  users: Row[];
  modules: Row[];
  departments: Row[];
  teams: Row[];
  teamMembers: Row[];
  contacts: Row[];
  invoices: Row[];
  expenses: Row[];
  inventoryItems: Row[];
  auditLogs: Row[];
  deals: Row[];
  supportTickets: Row[];
  tasks: Row[];
  attendanceRecords: Row[];
  leaveRequests: Row[];
  notifications: Row[];
  notificationPreferences: Row[];
  documents: Row[];
  formSubmissions: Row[];
  projects: Row[];
  attachments: Row[];
  roles: Row[];
  permissions: Row[];
  roleModulePermissions: Row[];
}

export function emptyWorkspaceState(): WorkspaceState {
  return {
    tenants: [],
    users: [],
    modules: [],
    departments: [],
    teams: [],
    teamMembers: [],
    contacts: [],
    invoices: [],
    expenses: [],
    inventoryItems: [],
    auditLogs: [],
    deals: [],
    supportTickets: [],
    tasks: [],
    attendanceRecords: [],
    leaveRequests: [],
    notifications: [],
    notificationPreferences: [],
    documents: [],
    formSubmissions: [],
    projects: [],
    attachments: [],
    roles: [],
    permissions: [],
    roleModulePermissions: [],
  };
}

const DELEGATES: Record<string, keyof WorkspaceState> = {
  tenant: 'tenants',
  user: 'users',
  module: 'modules',
  department: 'departments',
  team: 'teams',
  teamMember: 'teamMembers',
  contact: 'contacts',
  invoice: 'invoices',
  expense: 'expenses',
  inventoryItem: 'inventoryItems',
  auditLog: 'auditLogs',
  deal: 'deals',
  supportTicket: 'supportTickets',
  task: 'tasks',
  attendanceRecord: 'attendanceRecords',
  leaveRequest: 'leaveRequests',
  notification: 'notifications',
  notificationPreference: 'notificationPreferences',
  document: 'documents',
  formSubmission: 'formSubmissions',
  project: 'projects',
  attachment: 'attachments',
  role: 'roles',
  permission: 'permissions',
  roleModulePermission: 'roleModulePermissions',
};

const OPERATORS = new Set([
  'equals',
  'not',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'startsWith',
  'endsWith',
  'has',
  'hasSome',
  'some',
  'none',
  'every',
  'path',
  'string_contains',
  'string_starts_with',
  'string_ends_with',
]);

export function createFakeWorkspacePrisma(state: WorkspaceState) {
  const withTenant = jest.fn(
    async <T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> =>
      fn(createTx(tenantId, state)),
  );

  const prisma: any = {
    withTenant,
    $transaction: async (fn: any) => fn(createTx(undefined, state)),
    ...createTx(undefined, state),
  };

  return prisma;
}

function createTx(tenantId: string | undefined, state: WorkspaceState) {
  // `tenant` and `permission` are global catalogues, not RLS-scoped rows.
  const GLOBAL_KEYS = new Set<keyof WorkspaceState>(['tenants', 'permissions']);

  const visible = (rows: Row[], key?: keyof WorkspaceState): Row[] => {
    if (key && GLOBAL_KEYS.has(key)) return rows;
    return tenantId ? rows.filter((row) => row.tenantId === tenantId) : [];
  };

  const tx: any = {};

  for (const [delegate, key] of Object.entries(DELEGATES)) {
    tx[delegate] = {
      findMany: async (args: any = {}) => {
        const rows = visible(state[key], key).filter((row) =>
          matches(row, args.where, state),
        );
        const sorted = sortRows(rows, args.orderBy);
        const skip = args.skip ?? 0;
        const take = args.take;
        return (
          take === undefined
            ? sorted.slice(skip)
            : sorted.slice(skip, skip + take)
        ).map(clone);
      },

      findFirst: async (args: any = {}) => {
        const rows = visible(state[key], key).filter((row) =>
          matches(row, args.where, state),
        );
        const sorted = sortRows(rows, args.orderBy);
        return sorted[0] ? clone(sorted[0]) : null;
      },

      findUnique: async (args: any = {}) => {
        const rows = visible(state[key], key).filter((row) =>
          matches(row, args.where, state),
        );
        return rows[0] ? clone(rows[0]) : null;
      },

      count: async (args: any = {}) =>
        visible(state[key], key).filter((row) =>
          matches(row, args.where, state),
        ).length,

      aggregate: async (args: any = {}) => {
        const rows = visible(state[key], key).filter((row) =>
          matches(row, args.where, state),
        );
        return aggregateRows(rows, args);
      },

      groupBy: async (args: any = {}) => {
        const rows = visible(state[key], key).filter((row) =>
          matches(row, args.where, state),
        );
        const by = Array.isArray(args.by) ? args.by : [args.by];
        const groups = new Map<string, Row[]>();

        for (const row of rows) {
          const key = JSON.stringify(
            by.map((field: string) => row[field] ?? null),
          );
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(row);
        }

        return Array.from(groups.values())
          .map((groupRows) => ({
            ...Object.fromEntries(
              by.map((field: string) => [field, groupRows[0][field] ?? null]),
            ),
            ...aggregateRows(groupRows, args),
          }))
          .sort((a, b) => {
            const field = by[0];
            if (a[field] === b[field]) return 0;
            return String(a[field]) < String(b[field]) ? -1 : 1;
          });
      },

      create: async (args: any = {}) => {
        const now = new Date();
        const row: Row = {
          id: randomUUID(),
          ...args.data,
          createdAt: args.data?.createdAt ?? now,
          updatedAt: args.data?.updatedAt ?? now,
        };
        if (tenantId && row.tenantId === undefined) row.tenantId = tenantId;

        // Emulate schema defaults that callers rely on but never send.
        if (key === 'documents' && row.version === undefined) row.version = 1;
        if (key === 'notifications' && row.read === undefined) row.read = false;
        if (key === 'leaveRequests') {
          row.status ??= 'PENDING_TEAM_LEAD';
          row.currentStage ??= 1;
          row.submittedAt ??= now;
        }

        state[key].push(row);
        return clone(row);
      },

      createMany: async (args: any = {}) => {
        const entries = Array.isArray(args.data) ? args.data : [args.data];
        const now = new Date();
        let count = 0;

        for (const entry of entries) {
          if (!entry) continue;
          if (
            args.skipDuplicates &&
            state[key].some((row) =>
              Object.entries(entry).every(
                ([field, value]) => row[field] === value,
              ),
            )
          ) {
            continue;
          }

          const row: Row = {
            id: randomUUID(),
            ...entry,
            createdAt: entry.createdAt ?? now,
            updatedAt: entry.updatedAt ?? now,
          };
          if (tenantId && row.tenantId === undefined) row.tenantId = tenantId;
          state[key].push(row);
          count += 1;
        }

        return { count };
      },

      update: async (args: any = {}) => {
        const index = state[key].findIndex((row) =>
          matches(row, args.where, state),
        );
        if (index === -1) {
          throw new Error(`Record not found in ${String(key)}`);
        }
        const row = state[key][index];
        state[key][index] = applyData(row, args.data);
        return clone(state[key][index]);
      },

      updateMany: async (args: any = {}) => {
        let count = 0;
        state[key] = state[key].map((row) => {
          if (!matches(row, args.where, state)) return row;
          count += 1;
          return applyData(row, args.data);
        });
        return { count };
      },

      upsert: async (args: any = {}) => {
        const condition = normalizeCompoundWhere(args.where);
        const index = state[key].findIndex(
          (row) =>
            (!tenantId || row.tenantId === tenantId) &&
            matches(row, condition, state),
        );

        if (index !== -1) {
          state[key][index] = applyData(state[key][index], args.update);
          return clone(state[key][index]);
        }

        const now = new Date();
        const row: Row = {
          id: randomUUID(),
          ...args.create,
          createdAt: args.create?.createdAt ?? now,
          updatedAt: args.create?.updatedAt ?? now,
        };
        if (tenantId && row.tenantId === undefined) row.tenantId = tenantId;
        state[key].push(row);
        return clone(row);
      },

      delete: async (args: any = {}) => {
        const index = state[key].findIndex((row) =>
          matches(row, args.where, state),
        );
        if (index === -1) {
          throw new Error(`Record not found in ${String(key)}`);
        }
        const [removed] = state[key].splice(index, 1);
        return clone(removed);
      },
    };
  }

  return tx;
}

function clone<T>(row: T): T {
  if (row instanceof Date) return new Date(row.getTime()) as T;
  if (Array.isArray(row)) return row.map((entry) => clone(entry)) as T;
  if (row && typeof row === 'object') {
    const copy: Row = {};
    for (const [key, value] of Object.entries(row as Row)) {
      copy[key] = clone(value);
    }
    return copy as T;
  }
  return row;
}

/**
 * Flatten Prisma compound-unique selectors (`tenantId_userId_type`) into the
 * plain field predicates the in-memory matcher understands.
 */
function normalizeCompoundWhere(where: any): any {
  if (!where || typeof where !== 'object') return where;
  const normalized: Row = {};

  for (const [key, value] of Object.entries(where)) {
    if (
      key.includes('_') &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !Object.keys(value).some((part) => OPERATORS.has(part))
    ) {
      Object.assign(normalized, value);
      continue;
    }
    normalized[key] = value;
  }

  return normalized;
}

function applyData(row: Row, data: Row): Row {
  const next = { ...row };

  for (const [key, value] of Object.entries(data ?? {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      typeof (value as Row).increment === 'number'
    ) {
      next[key] = Number(next[key] ?? 0) + (value as Row).increment;
      continue;
    }
    next[key] = value;
  }

  next.updatedAt = new Date();
  return next;
}

function aggregateRows(rows: Row[], args: any): Row {
  const result: Row = {};

  for (const [operator, spec] of Object.entries(args ?? {})) {
    if (!['_sum', '_avg', '_min', '_max', '_count'].includes(operator))
      continue;

    if (operator === '_count') {
      result._count = { _all: rows.length };
      continue;
    }

    const output: Row = {};
    for (const field of Object.keys(spec as Row)) {
      const values = rows
        .map((row) => row[field])
        .filter((value) => value !== null && value !== undefined)
        .map((value) =>
          value instanceof Date ? value.getTime() : Number(value),
        )
        .filter((value) => Number.isFinite(value));

      if (operator === '_sum') {
        output[field] = values.reduce((sum, value) => sum + value, 0);
      } else if (operator === '_avg') {
        output[field] =
          values.length > 0
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : null;
      } else if (operator === '_min') {
        output[field] = values.length ? Math.min(...values) : null;
      } else {
        output[field] = values.length ? Math.max(...values) : null;
      }
    }
    result[operator] = output;
  }

  return result;
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  if (entries.length === 0) return rows;

  return [...rows].sort((a, b) => {
    for (const entry of entries) {
      const [field, rawDir] = Object.entries(entry)[0] as [string, any];

      if (rawDir && typeof rawDir === 'object') {
        const [subField, subDir] = Object.entries(rawDir)[0] as [string, any];
        const av = getNested(a, `${field}.${subField}`);
        const bv = getNested(b, `${field}.${subField}`);
        const compared = compare(av, bv);
        if (compared !== 0) return subDir === 'desc' ? -compared : compared;
        continue;
      }

      const compared = compare(getNested(a, field), getNested(b, field));
      if (compared !== 0) return rawDir === 'desc' ? -compared : compared;
    }
    return 0;
  });
}

function getNested(row: Row, path: string): any {
  return path.split('.').reduce((value: any, key) => value?.[key], row);
}

function compare(a: any, b: any): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  return av < bv ? -1 : 1;
}

function matches(row: Row, where: any, state: WorkspaceState): boolean {
  if (!where) return true;

  for (const [key, condition] of Object.entries(where)) {
    if (key === 'AND') {
      if (!(condition as any[]).every((clause) => matches(row, clause, state)))
        return false;
      continue;
    }
    if (key === 'OR') {
      if (!(condition as any[]).some((clause) => matches(row, clause, state)))
        return false;
      continue;
    }
    if (key === 'NOT') {
      if (matches(row, condition, state)) return false;
      continue;
    }
    if (!matchValue(row[key], condition, state)) return false;
  }

  return true;
}

function matchValue(
  value: any,
  condition: any,
  state: WorkspaceState,
): boolean {
  if (condition === null) return value === null || value === undefined;

  if (condition instanceof Date) {
    return toTime(value) === condition.getTime();
  }

  if (typeof condition !== 'object' || Array.isArray(condition)) {
    return equal(value, condition);
  }

  if (Array.isArray(value)) {
    if ('some' in condition) {
      return value.some((entry) => matches(entry, condition.some, state));
    }
    if ('none' in condition) {
      return value.every((entry) => !matches(entry, condition.none, state));
    }
    if ('every' in condition) {
      return value.every((entry) => matches(entry, condition.every, state));
    }
  }

  const keys = Object.keys(condition);
  const isOperator = keys.some((key) => OPERATORS.has(key));

  if (!isOperator) {
    if (Array.isArray(value)) {
      return value.some((entry) => matches(entry, condition, state));
    }
    if (value && typeof value === 'object') {
      return matches(value, condition, state);
    }
    return false;
  }

  if (Array.isArray(condition.path)) {
    const target = (condition.path as string[]).reduce(
      (current, key) => current?.[key],
      value,
    );
    const rest = { ...condition };
    delete rest.path;
    return matchValue(target, rest, state);
  }

  for (const [operator, operand] of Object.entries(condition)) {
    switch (operator) {
      case 'equals':
        if (!matchValue(value, operand, state)) return false;
        break;
      case 'not':
        if (matchValue(value, operand, state)) return false;
        break;
      case 'in':
        if (!(operand as any[]).some((entry) => equal(value, entry)))
          return false;
        break;
      case 'notIn':
        if ((operand as any[]).some((entry) => equal(value, entry)))
          return false;
        break;
      case 'gt':
        if (!(toComparable(value) > toComparable(operand))) return false;
        break;
      case 'gte':
        if (!(toComparable(value) >= toComparable(operand))) return false;
        break;
      case 'lt':
        if (!(toComparable(value) < toComparable(operand))) return false;
        break;
      case 'lte':
        if (!(toComparable(value) <= toComparable(operand))) return false;
        break;
      case 'contains': {
        const nested =
          operand && typeof operand === 'object' && 'contains' in operand;
        const needle = String(nested ? operand.contains : (operand ?? ''));
        const insensitive =
          condition.mode === 'insensitive' ||
          (nested && (operand as any).mode === 'insensitive');

        if (Array.isArray(value)) {
          if (!value.includes(operand)) return false;
          break;
        }

        if (
          insensitive
            ? !String(value ?? '')
                .toLowerCase()
                .includes(needle.toLowerCase())
            : !String(value ?? '').includes(needle)
        ) {
          return false;
        }
        break;
      }
      case 'startsWith':
        if (!String(value ?? '').startsWith(String(operand))) return false;
        break;
      case 'endsWith':
        if (!String(value ?? '').endsWith(String(operand))) return false;
        break;
      case 'has':
        if (!Array.isArray(value) || !value.includes(operand)) return false;
        break;
      case 'hasSome':
        if (
          !Array.isArray(value) ||
          !(operand as any[]).some((entry) => value.includes(entry))
        ) {
          return false;
        }
        break;
      case 'some':
        if (
          !Array.isArray(value) ||
          !value.some((entry) => matches(entry, operand, state))
        )
          return false;
        break;
      case 'none':
        if (
          !Array.isArray(value) ||
          !value.every((entry) => !matches(entry, operand, state))
        )
          return false;
        break;
      case 'every':
        if (
          !Array.isArray(value) ||
          !value.every((entry) => matches(entry, operand, state))
        )
          return false;
        break;
      case 'string_contains':
        if (!String(value ?? '').includes(String(operand))) return false;
        break;
      case 'string_starts_with':
        if (!String(value ?? '').startsWith(String(operand))) return false;
        break;
      case 'string_ends_with':
        if (!String(value ?? '').endsWith(String(operand))) return false;
        break;
      default:
        break;
    }
  }

  return true;
}

function equal(a: any, b: any): boolean {
  if (a instanceof Date || b instanceof Date) return toTime(a) === toTime(b);
  return a === b;
}

function toTime(value: any): number | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function toComparable(value: any): any {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).getTime();
  }
  return value;
}

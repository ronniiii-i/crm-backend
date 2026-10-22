/**
 * Test doubles for Prisma that emulate the tenant-scoped behaviour of the
 * real service without requiring a live database.
 *
 * The real `PrismaService.withTenant()` opens a transaction and issues
 * `SET LOCAL app.current_tenant = $1`, which makes Postgres RLS apply. These
 * fakes mirror that contract: every read is filtered by the active tenant and
 * a query made *without* a tenant context returns nothing (fail-closed).
 */

import { PermissionType, PermissionEffect } from '@prisma/client';

export interface FakeRow {
  id: string;
  tenantId?: string | null;
  [key: string]: unknown;
}

export interface FakeDbState {
  users?: FakeRow[];
  modules?: FakeRow[];
  roleModulePermissions?: FakeRow[];
  permissionGroups?: FakeRow[];
  permissionGroupItems?: FakeRow[];
  permissionGroupAssignments?: FakeRow[];
  permissionOverrides?: FakeRow[];
  departments?: FakeRow[];
  teams?: FakeRow[];
  contacts?: FakeRow[];
  deals?: FakeRow[];
  supportTickets?: FakeRow[];
  projects?: FakeRow[];
  invoices?: FakeRow[];
  attendanceRecords?: FakeRow[];
}

const TENANT_COLUMN: Record<string, string> = {
  roleModulePermission: 'tenantId',
  permissionGroup: 'tenantId',
  permissionGroupItem: 'tenantId',
  permissionGroupAssignment: 'tenantId',
  permissionOverride: 'tenantId',
};

/**
 * Builds a `PrismaService` double whose `withTenant()` scopes every read to
 * the supplied tenant. Queries issued outside a tenant scope resolve to an
 * empty set, mirroring RLS fail-closed behaviour.
 */
export function createFakePrisma(state: FakeDbState = {}) {
  const withTenant = jest.fn(
    async <T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> => {
      const tx = createTenantTx(tenantId, state);
      return fn(tx);
    },
  );

  const prisma: any = {
    withTenant,
    $transaction: async (fn: any) => fn(prisma),
    // Root-level accessors resolve to the "no tenant" scope → fail-closed.
    ...createTenantTx(undefined, state),
  };

  return prisma;
}

function createTenantTx(tenantId: string | undefined, state: FakeDbState) {
  const scope = (rows: FakeRow[] | undefined): FakeRow[] => {
    if (!rows) return [];
    if (!tenantId) return []; // fail-closed
    return rows.filter((row) => row.tenantId === tenantId);
  };

  const tx: any = {
    user: {
      findMany: async (args: any = {}) => filter(scope(state.users), args),
      findFirst: async (args: any = {}) => filter(scope(state.users), args)[0],
      findUnique: async (args: any = {}) => filter(scope(state.users), args)[0],
      count: async (args: any = {}) => filter(scope(state.users), args).length,
    },
    module: {
      findMany: async (args: any = {}) => filter(scope(state.modules), args),
      findFirst: async (args: any = {}) =>
        filter(scope(state.modules), args)[0],
      findUnique: async (args: any = {}) =>
        filter(scope(state.modules), args)[0],
    },
    roleModulePermission: {
      findMany: async (args: any = {}) =>
        filter(scope(state.roleModulePermissions), args),
    },
    permissionGroupAssignment: {
      findMany: async (args: any = {}) =>
        filter(scope(state.permissionGroupAssignments), args),
    },
    permissionOverride: {
      findMany: async (args: any = {}) =>
        filter(scope(state.permissionOverrides), args),
    },
    contact: {
      findMany: async (args: any = {}) => filter(scope(state.contacts), args),
    },
    deal: {
      findMany: async (args: any = {}) => filter(scope(state.deals), args),
    },
    supportTicket: {
      findMany: async (args: any = {}) =>
        filter(scope(state.supportTickets), args),
    },
    project: {
      findMany: async (args: any = {}) => filter(scope(state.projects), args),
    },
    invoice: {
      findMany: async (args: any = {}) => filter(scope(state.invoices), args),
    },
    attendanceRecord: {
      findMany: async (args: any = {}) =>
        filter(scope(state.attendanceRecords), args),
    },
  };

  return tx;
}

/** Very small subset of Prisma's `where` clause support. */
function filter(rows: FakeRow[], args: any = {}): FakeRow[] {
  const where = args?.where;
  if (!where) return rows;

  return rows.filter((row) => {
    if (where.tenantId && row.tenantId !== where.tenantId) return false;
    if (where.id && row.id !== where.id) return false;
    if (where.role && row.role !== where.role) return false;
    if (where.moduleId && row.moduleId !== where.moduleId) return false;
    if (where.userId && row.userId !== where.userId) return false;
    if (where.groupId && row.groupId !== where.groupId) return false;
    if (where.effect && row.effect !== where.effect) return false;
    if (where.permissionType && row.permissionType !== where.permissionType)
      return false;
    if (where.path && row.path !== where.path) return false;
    if (where.departmentId && row.departmentId !== where.departmentId)
      return false;

    if (Array.isArray(where.OR)) {
      const orMatch = where.OR.some((clause: any) =>
        Object.entries(clause).every(([key, value]) => {
          if (key === 'departmentId' && value && typeof value === 'object') {
            const inList = (value as any).in as string[] | undefined;
            return !inList || inList.includes(row.departmentId as string);
          }
          return row[key] === value;
        }),
      );
      if (!orMatch) return false;
    }

    return true;
  });
}

/** Builds a `RoleModulePermission`-shaped row. */
export function rolePermissionRow(params: {
  tenantId: string;
  role: string;
  moduleId: string;
  permissionType: PermissionType;
  id?: string;
}): FakeRow {
  return {
    id:
      params.id ??
      `rpm-${params.role}-${params.moduleId}-${params.permissionType}`,
    tenantId: params.tenantId,
    role: params.role,
    moduleId: params.moduleId,
    permissionType: params.permissionType,
    permission: { type: params.permissionType },
  };
}

/** Builds a `PermissionOverride`-shaped row. */
export function overrideRow(params: {
  tenantId: string;
  userId: string;
  moduleId: string;
  permissionType: PermissionType;
  effect: PermissionEffect;
  id?: string;
}): FakeRow {
  return {
    id:
      params.id ??
      `po-${params.userId}-${params.moduleId}-${params.permissionType}`,
    tenantId: params.tenantId,
    userId: params.userId,
    moduleId: params.moduleId,
    permissionType: params.permissionType,
    effect: params.effect,
    permission: { type: params.permissionType },
  };
}

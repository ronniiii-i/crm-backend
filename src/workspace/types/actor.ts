import { RoleDataScope } from '@prisma/client';

/** Authenticated user shape used by the workspace services. */
export interface WorkspaceActor {
  id: string;
  tenantId: string;
  roleId: string;
  roleSlug?: string | null;
  dataScope: RoleDataScope | string;
  departmentId: string | null;
  managedDepartmentId: string | null;
  isTenantAdmin: boolean;
}

/** Convert the JWT user payload into the workspace actor shape. */
export function toWorkspaceActor(user: {
  id?: string;
  sub?: string;
  userId?: string;
  tenantId?: string;
  roleId?: string;
  roleSlug?: string;
  dataScope?: string;
  departmentId?: string | null;
  managedDepartmentId?: string | null;
  isTenantAdmin?: boolean;
}): WorkspaceActor {
  const id = user.id ?? user.sub ?? user.userId ?? '';
  if (!id || !user.tenantId) {
    throw new Error('Workspace actor requires an id and tenantId.');
  }

  return {
    id,
    tenantId: user.tenantId,
    roleId: user.roleId ?? '',
    roleSlug: user.roleSlug ?? null,
    dataScope: user.dataScope ?? 'SELF',
    departmentId: user.departmentId ?? null,
    managedDepartmentId: user.managedDepartmentId ?? null,
    isTenantAdmin: user.isTenantAdmin === true,
  };
}

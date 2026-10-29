import { Department, Permission, ProtectedRoute } from './permission-types';
import { DEFAULT_MODULES } from '../tenant/defaults';

const moduleMap = new Map(DEFAULT_MODULES.map((m) => [m.key, m]));

function getRoute(id: string): ProtectedRoute {
  const module = moduleMap.get(id);
  if (!module) {
    return {
      id,
      path: '/',
      name: id,
      permissions: {
        ADMIN: [Permission.VIEW],
        HOD: [Permission.VIEW],
        LEAD: [Permission.VIEW],
        STAFF: [Permission.VIEW],
      },
    };
  }

  const permissions = {
    ADMIN: module.defaultPermissions.tenant_admin.map((p) =>
      p === 'VIEW'
        ? Permission.VIEW
        : p === 'CREATE'
          ? Permission.CREATE
          : p === 'EDIT'
            ? Permission.EDIT
            : Permission.DELETE,
    ),
    HOD: module.defaultPermissions.department_head.map((p) =>
      p === 'VIEW'
        ? Permission.VIEW
        : p === 'CREATE'
          ? Permission.CREATE
          : p === 'EDIT'
            ? Permission.EDIT
            : Permission.DELETE,
    ),
    LEAD: module.defaultPermissions.team_lead.map((p) =>
      p === 'VIEW'
        ? Permission.VIEW
        : p === 'CREATE'
          ? Permission.CREATE
          : p === 'EDIT'
            ? Permission.EDIT
            : Permission.DELETE,
    ),
    STAFF: module.defaultPermissions.staff.map((p) =>
      p === 'VIEW'
        ? Permission.VIEW
        : p === 'CREATE'
          ? Permission.CREATE
          : p === 'EDIT'
            ? Permission.EDIT
            : Permission.DELETE,
    ),
  };

  return {
    id: module.key,
    path: module.path,
    name: module.name,
    icon: module.icon,
    department: module.departmentKey
      ? mapDepartment(module.departmentKey)
      : undefined,
    permissions,
  };
}

function mapDepartment(key?: string): Department | undefined {
  switch (key) {
    case 'finance':
      return Department.FINANCE;
    case 'accounting':
      return Department.ACCOUNTING;
    case 'information_technology':
      return Department.IT;
    case 'sales':
      return Department.SALES;
    case 'customer_support':
      return Department.CUSTOMER_SUPPORT;
    case 'human_resources':
      return Department.HR;
    case 'administration':
      return Department.ADMINISTRATION;
    case 'operations':
      return Department.OPERATIONS;
    default:
      return undefined;
  }
}

export const ALL_ROUTES: ProtectedRoute[] = DEFAULT_MODULES.map((module) =>
  getRoute(module.key),
);

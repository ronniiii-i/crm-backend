// src/auth/route-registry.ts
import {
  Department,
  Permission,
  ProtectedRouteConfig,
} from './permission-types';

export const PROTECTED_ROUTES: ProtectedRouteConfig[] = [
  // Global Modules
  {
    path: '/dashboard',
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT],
      HOD: [Permission.VIEW],
      LEAD: [Permission.VIEW],
      STAFF: [Permission.VIEW],
    },
  },
  {
    path: '/analytics',
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  // Administration
  {
    path: '/admin/settings',
    department: Department.ADMINISTRATION,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [],
      LEAD: [],
      STAFF: [],
    },
  },
  // Finance
  {
    path: '/finance/analytics',
    department: Department.FINANCE,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  // IT
  {
    path: '/it/health',
    department: Department.IT,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  // Add all other routes from your frontend ALL_MODULES here...

  {
    path: '/test-acl/admin-only',
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [],
      LEAD: [],
      STAFF: [],
    },
  },
  {
    path: '/test-acl/finance-data',
    department: Department.FINANCE,
    permissions: {
      ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
      HOD: [Permission.VIEW, Permission.EDIT],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
  {
    path: '/test-acl/create-operation',
    permissions: {
      ADMIN: [
        Permission.CREATE,
        Permission.VIEW,
        Permission.EDIT,
        Permission.DELETE,
      ],
      HOD: [Permission.CREATE, Permission.VIEW],
      LEAD: [Permission.VIEW],
      STAFF: [],
    },
  },
];
// export { Permission };

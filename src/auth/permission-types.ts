// src/auth/permission-types.ts
export enum Permission {
  VIEW = 'VIEW',
  CREATE = 'CREATE',
  EDIT = 'EDIT',
  DELETE = 'DELETE',
}

export enum Department {
  FINANCE = 'Finance',
  IT = 'IT',
  SALES = 'Sales',
  CUSTOMER_SUPPORT = 'Customer Support',
  HR = 'Human Resources',
  ACCOUNTING = 'Accounting',
  ADMINISTRATION = 'Administration',
  OPERATIONS = 'Operations',
}

export interface ProtectedRouteConfig {
  path: string;
  permissions: {
    ADMIN: Permission[];
    HOD: Permission[];
    LEAD: Permission[];
    STAFF: Permission[];
  };
  department?: Department;
}

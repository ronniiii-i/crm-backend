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

export interface ProtectedRoute {
  id?: string;
  path: string;
  name?: string;
  department?: Department | Department[];
  icon?: string;
  permissions: {
    ADMIN: Permission[];
    HOD: Permission[];
    LEAD: Permission[];
    STAFF: Permission[];
  };
}

export type UserWithDepartments = {
  id: string;
  role: 'ADMIN' | 'HOD' | 'LEAD' | 'STAFF';
  department?: { name: Department };
  managedDepartment?: { name: Department };
};

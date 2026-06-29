export enum Permission {
  VIEW = 'VIEW',
  CREATE = 'CREATE',
  EDIT = 'EDIT',
  DELETE = 'DELETE',
}

export enum Department {
  FINANCE = 'FINANCE',
  IT = 'INFORMATION_TECHNOLOGY',
  SALES = 'SALES',
  CUSTOMER_SUPPORT = 'CUSTOMER_SERVICE',
  HR = 'HUMAN_RESOURCES',
  ADMINISTRATION = 'ADMINISTRATION',
  OPERATIONS = 'OPERATIONS',
}

export interface ProtectedRoute {
  id: string;
  path: string;
  name: string;
  department?: Department | Department[];
  icon?: string;
  group?: string;
  order?: number;
  permissions: {
    ADMIN: Permission[];
    HOD: Permission[];
    LEAD: Permission[];
    STAFF: Permission[];
  };
}

export interface AccessibleModule {
  id: string;
  name: string;
  path: string;
  icon?: string | null;
}

export interface UserForAcl {
  id: string;
  role: string;
  department?: { type: string } | null;
  managedDepartment?: { type: string } | null;
}

export type UserWithDepartments = UserForAcl;

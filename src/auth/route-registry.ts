// src/auth/route-registry.ts
import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { Department, Permission, ProtectedRoute } from './permission-types';

@Injectable()
export class RouteRegistry {
  public readonly ALL_ROUTES: ProtectedRoute[] = [
    // Global Modules (No Department)
    {
      id: 'dashboard',
      name: 'Dashboard Overview',
      icon: 'LayoutDashboard',
      path: '/dashboard',
      permissions: {
        ADMIN: [Permission.VIEW, Permission.EDIT],
        HOD: [Permission.VIEW],
        LEAD: [Permission.VIEW],
        STAFF: [Permission.VIEW],
      },
    },
    {
      id: 'analytics',
      name: 'Business Intelligence',
      icon: 'BarChart',
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
      id: 'admin-settings',
      name: 'System Administration',
      icon: 'Settings',
      path: '/admin/settings',
      department: Department.ADMINISTRATION,
      permissions: {
        ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
        HOD: [],
        LEAD: [],
        STAFF: [],
      },
    },
    {
      id: 'office-admin',
      name: 'Office Administration',
      icon: 'Home',
      path: '/office',
      department: Department.ADMINISTRATION,
      permissions: {
        ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
        HOD: [Permission.VIEW],
        LEAD: [],
        STAFF: [Permission.VIEW],
      },
    },
    // Finance
    {
      id: 'financial-analytics',
      name: 'Financial Analytics',
      icon: 'Landmark',
      path: '/finance/analytics',
      department: Department.FINANCE,
      permissions: {
        ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
        HOD: [Permission.VIEW, Permission.EDIT],
        LEAD: [Permission.VIEW],
        STAFF: [],
      },
    },
    {
      id: 'tax-management',
      name: 'Tax Management',
      icon: 'Receipt',
      path: '/finance/tax',
      department: Department.FINANCE,
      permissions: {
        ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
        HOD: [Permission.VIEW, Permission.EDIT],
        LEAD: [],
        STAFF: [],
      },
    },
    // IT
    {
      id: 'system-health',
      name: 'System Health',
      icon: 'Server',
      path: '/it/health',
      department: Department.IT,
      permissions: {
        ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
        HOD: [Permission.VIEW, Permission.EDIT],
        LEAD: [Permission.VIEW],
        STAFF: [],
      },
    },
    // Sales
    {
      id: 'sales-pipeline',
      name: 'Sales Pipeline',
      icon: 'Globe',
      path: '/sales/pipeline',
      department: Department.SALES,
      permissions: {
        ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
        HOD: [Permission.VIEW, Permission.EDIT],
        LEAD: [Permission.VIEW],
        STAFF: [Permission.VIEW],
      },
    },
    {
      id: 'territory-management',
      name: 'Territory Management',
      icon: 'Map',
      path: '/sales/territory',
      department: Department.SALES,
      permissions: {
        ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
        HOD: [Permission.VIEW, Permission.EDIT],
        LEAD: [Permission.VIEW],
        STAFF: [],
      },
    },
    // Customer Support
    {
      id: 'sla-management',
      name: 'SLA Management',
      icon: 'Clock',
      path: '/support/sla',
      department: Department.CUSTOMER_SUPPORT,
      permissions: {
        ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
        HOD: [Permission.VIEW, Permission.EDIT],
        LEAD: [Permission.VIEW],
        STAFF: [],
      },
    },
    // HR
    {
      id: 'health-safety',
      name: 'Health & Safety',
      icon: 'Shield',
      path: '/hr/safety',
      department: Department.HR,
      permissions: {
        ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
        HOD: [Permission.VIEW, Permission.EDIT],
        LEAD: [Permission.VIEW],
        STAFF: [Permission.VIEW],
      },
    },
    // Accounting
    {
      id: 'general-ledger',
      name: 'General Ledger',
      icon: 'ClipboardList',
      path: '/accounting/ledger',
      department: Department.ACCOUNTING,
      permissions: {
        ADMIN: [Permission.VIEW, Permission.EDIT, Permission.DELETE],
        HOD: [Permission.VIEW, Permission.EDIT],
        LEAD: [],
        STAFF: [],
      },
    },

    // Add all other routes from your frontend ALL_MODULES here

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
  constructor(private readonly cache: CacheService) {}

  findRoute(path: string): Promise<ProtectedRoute | undefined> {
    const cacheKey = `route:${path}`;
    const cached = this.cache.get(cacheKey) as ProtectedRoute | undefined;
    if (cached) return Promise.resolve(cached);

    const route = this.ALL_ROUTES.find((r) => r.path === path);
    if (route) this.cache.set(cacheKey, route, 3600);

    return Promise.resolve(route);
  }

  async clearCache(): Promise<void> {
    const keys: string[] = Array.isArray(this.cache.getStats().keys)
      ? Array.isArray(this.cache.getStats().keys)
        ? ((Array.isArray(this.cache.getStats().keys)
            ? this.cache.getStats().keys
            : []) as string[])
        : []
      : [];
    await Promise.all(
      keys.filter((k) => k.startsWith('route:')).map((k) => this.cache.del(k)),
    );
  }
}

import { Test } from '@nestjs/testing';
import { ModuleType, PermissionType } from '@prisma/client';
import {
  CacheService,
  InMemoryRedisClient,
  REDIS_CLIENT_FACTORY,
} from '../cache/cache.service';
import { FrontendAdapterService } from './frontend-adapter.service';
import { Permission } from './permission-types';
import { UsersService } from '../users/users.service';
import { AccessControlService } from '../access-control/access-control.service';
import { runWithTenant } from '../tenant/tenant-context';

const TENANT = 'tenant-1';

function moduleRow(overrides: Record<string, any> = {}) {
  return {
    id: 'module-1',
    tenantId: TENANT,
    key: 'contacts',
    name: 'Contacts',
    path: '/dept/sales/contacts',
    icon: null,
    group: 'Sales',
    order: 1,
    type: ModuleType.DATA_TABLE,
    targetEntity: 'contact',
    isNavigable: true,
    departmentId: null,
    department: null,
    ...overrides,
  };
}

function department(id: string, key: string, name: string, sortOrder: number) {
  return { id, key, name, sortOrder };
}

/** Minimal recursive matcher for the subset of `where` used by the adapter. */
function matches(where: any, row: any): boolean {
  if (!where) return true;

  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') {
      return (value as any[]).every((clause) => matches(clause, row));
    }
    if (key === 'OR') {
      return (value as any[]).some((clause) => matches(clause, row));
    }
    if (key === 'id' && value && typeof value === 'object' && 'in' in value) {
      return (value as any).in.includes(row.id);
    }
    if (
      key === 'departmentId' &&
      value &&
      typeof value === 'object' &&
      'in' in value
    ) {
      return (value as any).in.includes(row.departmentId);
    }
    return row[key] === value;
  });
}

function createModulePrisma(rows: any[]) {
  const findMany = jest.fn(async (args: any = {}) =>
    rows.filter((row) => matches(args.where, row)),
  );

  return {
    findMany,
    prisma: {
      module: { findMany },
      withTenant: jest.fn(async (tenantId: string, fn: (tx: any) => any) =>
        fn({ module: { findMany } }),
      ),
    },
  };
}

function effective(moduleId: string, actions: PermissionType[]) {
  return [moduleId, new Set(actions)] as const;
}

describe('FrontendAdapterService navigation payload', () => {
  let cache: CacheService;

  const globalModule = moduleRow({
    id: 'm-global',
    key: 'contacts',
    name: 'Contacts',
    path: '/dept/global/contacts',
    order: 2,
  });
  const deals = moduleRow({
    id: 'm-deals',
    key: 'deals',
    name: 'Deals',
    path: '/dept/sales/deals',
    order: 1,
    departmentId: 'd-sales',
    department: department('d-sales', 'sales', 'Sales', 1),
  });
  const invoices = moduleRow({
    id: 'm-invoices',
    key: 'invoices',
    name: 'Invoices',
    path: '/dept/finance/invoices',
    order: 3,
    departmentId: 'd-finance',
    department: department('d-finance', 'finance', 'Finance', 2),
  });
  const support = moduleRow({
    id: 'm-support',
    key: 'support',
    name: 'Support',
    path: '/dept/support/support',
    order: 1,
    departmentId: 'd-support',
    department: department('d-support', 'support', 'Support', 3),
  });
  const hidden = moduleRow({
    id: 'm-hidden',
    key: 'hidden',
    name: 'Hidden',
    path: '/dept/sales/hidden',
    order: 0,
    departmentId: 'd-sales',
    department: department('d-sales', 'sales', 'Sales', 1),
  });

  const rows = [invoices, support, deals, globalModule, hidden];

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: REDIS_CLIENT_FACTORY,
          useValue: () => new InMemoryRedisClient(),
        },
        CacheService,
      ],
    }).compile();

    cache = moduleRef.get(CacheService);
    await cache.onModuleInit();
  });

  afterEach(async () => {
    await cache.onModuleDestroy();
  });

  function buildAdapter(
    permissionsByModule: ReadonlyArray<readonly [string, Set<PermissionType>]>,
  ) {
    const { prisma } = createModulePrisma(rows);
    const permissions = {
      getEffectivePermissions: jest.fn(
        async () => new Map(permissionsByModule),
      ),
    } as any;

    return {
      adapter: new FrontendAdapterService(prisma as any, cache, permissions),
      permissions,
      prisma,
    };
  }

  it('returns renderer metadata, canonical actions and department grouping', async () => {
    const { adapter } = buildAdapter([
      effective('m-global', [
        PermissionType.CREATE,
        PermissionType.VIEW,
        PermissionType.EDIT,
      ]),
      effective('m-deals', [PermissionType.VIEW, PermissionType.DELETE]),
      effective('m-invoices', [PermissionType.VIEW]),
      effective('m-support', [PermissionType.VIEW]),
      effective('m-hidden', [PermissionType.CREATE]),
    ]);

    const result = await adapter.getAccessibleModules({
      id: 'user-1',
      role: 'role-1',
      tenantId: TENANT,
      departmentId: 'd-sales',
      managedDepartmentId: null,
    } as any);

    // Global modules sort first, then departments by sortOrder. The user only
    // sees their own department plus global modules.
    expect(result.map((entry) => entry.key)).toEqual(['contacts', 'deals']);

    const contacts = result[0];
    expect(contacts).toMatchObject({
      id: 'm-global',
      key: 'contacts',
      name: 'Contacts',
      path: '/dept/global/contacts',
      group: 'Sales',
      order: 2,
      type: ModuleType.DATA_TABLE,
      targetEntity: 'contact',
      isNavigable: true,
      department: null,
    });
    expect(contacts.actions).toEqual([
      Permission.VIEW,
      Permission.CREATE,
      Permission.EDIT,
    ]);

    const deal = result[1];
    expect(deal.department).toEqual({
      id: 'd-sales',
      key: 'sales',
      name: 'Sales',
      sortOrder: 1,
    });
    expect(deal.actions).toEqual([Permission.VIEW, Permission.DELETE]);
  });

  it('lets tenant admins see every department in a deterministic order', async () => {
    const { adapter } = buildAdapter([
      effective('m-global', [PermissionType.VIEW]),
      effective('m-deals', [PermissionType.VIEW]),
      effective('m-invoices', [PermissionType.VIEW]),
      effective('m-support', [PermissionType.VIEW]),
      effective('m-hidden', [PermissionType.CREATE]),
    ]);

    const result = await adapter.getAccessibleModules({
      id: 'admin-1',
      role: 'role-admin',
      tenantId: TENANT,
      isTenantAdmin: true,
    } as any);

    expect(result.map((entry) => entry.key)).toEqual([
      'contacts',
      'deals',
      'invoices',
      'support',
    ]);
  });

  it('caches the payload under the v2 key and recomputes after invalidation', async () => {
    const { adapter, permissions } = buildAdapter([
      effective('m-global', [PermissionType.VIEW]),
    ]);

    const user = {
      id: 'user-1',
      role: 'role-1',
      tenantId: TENANT,
      dataScope: 'TENANT',
    } as any;

    await adapter.getAccessibleModules(user);
    await adapter.getAccessibleModules(user);

    expect(permissions.getEffectivePermissions).toHaveBeenCalledTimes(1);
    await expect(
      cache.get(cache.tenantKey('user:user-1:modules:v2', TENANT)),
    ).resolves.toHaveLength(1);

    await cache.invalidateTenantAcls(TENANT);
    await adapter.getAccessibleModules(user);

    expect(permissions.getEffectivePermissions).toHaveBeenCalledTimes(2);
  });
});

describe('ACL cache invalidation hooks', () => {
  let cache: CacheService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: REDIS_CLIENT_FACTORY,
          useValue: () => new InMemoryRedisClient(),
        },
        CacheService,
      ],
    }).compile();

    cache = moduleRef.get(CacheService);
    await cache.onModuleInit();
  });

  afterEach(async () => {
    await cache.onModuleDestroy();
  });

  async function seedUserCaches(userId: string) {
    const modulesKey = cache.tenantKey(`user:${userId}:modules:v2`, TENANT);
    const permissionsKey = cache.tenantKey(
      `user:${userId}:effective-permissions`,
      TENANT,
    );
    await cache.set(modulesKey, [{ key: 'contacts' }], 900);
    await cache.set(permissionsKey, [{ moduleId: 'm-1' }], 300);
    return { modulesKey, permissionsKey };
  }

  it('drops a user payload when their role or department changes', async () => {
    const user = {
      id: 'user-1',
      tenantId: TENANT,
      email: 'user@example.com',
      roleId: 'role-1',
      departmentId: 'd-sales',
      status: 'ACTIVE',
    };
    const updated = { ...user, roleId: 'role-2' };

    const prisma = {
      withTenant: jest.fn(async (_tenantId: string, fn: (tx: any) => any) =>
        fn({
          user: {
            findUnique: jest.fn(async () => user),
            update: jest.fn(async () => updated),
          },
          role: { findFirst: jest.fn(async () => ({ id: 'role-2' })) },
          department: { findFirst: jest.fn(async () => ({ id: 'd-sales' })) },
        }),
      ),
    };
    const sessionState = { flushUser: jest.fn(async () => undefined) };

    // UsersService reads the tenant from request context; supplying it keeps
    // the fake on the tenant-scoped branch.
    const service = new UsersService(prisma as any, sessionState as any, cache);

    const { modulesKey, permissionsKey } = await seedUserCaches('user-1');

    await runWithTenant(TENANT, () =>
      service.updateUser('user-1', { roleId: 'role-2' } as any),
    );

    expect(sessionState.flushUser).toHaveBeenCalledWith(TENANT, 'user-1');
    await expect(cache.get(modulesKey)).resolves.toBeUndefined();
    await expect(cache.get(permissionsKey)).resolves.toBeUndefined();
  });

  it('drops tenant ACL payloads when role permissions change', async () => {
    const roles = [{ id: 'role-1', tenantId: TENANT, isTenantAdmin: false }];
    const modules = [{ id: 'm-1', tenantId: TENANT, key: 'contacts' }];
    const permissions = [
      { id: 1, type: 'VIEW' },
      { id: 2, type: 'CREATE' },
    ];
    const grants: any[] = [];

    const tx = {
      role: {
        findFirst: async (args: any) =>
          roles.find((role) => role.id === args.where.id),
      },
      roleModulePermission: {
        deleteMany: async (args: any) => {
          for (let i = grants.length - 1; i >= 0; i -= 1) {
            if (grants[i].roleId === args.where.roleId) grants.splice(i, 1);
          }
        },
        create: async (args: any) => {
          grants.push(args.data);
        },
        findMany: async (args: any) =>
          grants.filter((grant) => grant.roleId === args.where.roleId),
      },
      module: {
        findMany: async () => modules,
        findFirst: async (args: any) =>
          modules.find((module) => module.key === args.where.key),
      },
      permission: {
        findMany: async () => permissions,
        findFirst: async (args: any) =>
          permissions.find((permission) => permission.type === args.where.type),
      },
    };

    const prisma = {
      withTenant: jest.fn(async (_tenantId: string, fn: (tx: any) => any) =>
        fn(tx),
      ),
    };

    const service = new AccessControlService(prisma as any, cache);
    const { modulesKey, permissionsKey } = await seedUserCaches('user-1');

    await service.updateRolePermissions(TENANT, 'role-1', [
      { moduleKey: 'contacts', action: 'VIEW', granted: true },
    ]);

    expect(grants).toHaveLength(1);
    await expect(cache.get(modulesKey)).resolves.toBeUndefined();
    await expect(cache.get(permissionsKey)).resolves.toBeUndefined();
  });
});

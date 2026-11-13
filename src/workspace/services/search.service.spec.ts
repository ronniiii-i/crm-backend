import { BadRequestException } from '@nestjs/common';

import { AccessibleModule, Permission } from '../../auth/permission-types';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityRegistryService } from './entity-registry.service';
import { ScopeFilterService } from './scope-filter.service';
import { SearchService } from './search.service';

const TENANT = 'tenant-1';
const SALES = 'dept-sales';
const OPERATIONS = 'dept-operations';

const ADMIN = {
  id: 'user-admin',
  role: 'ADMIN',
  tenantId: TENANT,
  dataScope: 'TENANT',
  departmentId: null,
  managedDepartmentId: null,
  isTenantAdmin: true,
};

function module(
  id: string,
  key: string,
  name: string,
  path: string,
  targetEntity: string | null,
  department: { id: string; key: string; name: string },
  type = 'DATA_TABLE',
): AccessibleModule {
  return {
    id,
    key,
    name,
    path,
    group: department.name,
    order: 1,
    type: type as AccessibleModule['type'],
    targetEntity,
    isNavigable: true,
    department: { ...department, sortOrder: 1 },
    actions: [Permission.VIEW],
  };
}

const MODULE_CONTACTS = module(
  'module-contacts',
  'contacts',
  'Contacts',
  '/dept/sales/contacts',
  'contacts',
  { id: SALES, key: 'sales', name: 'Sales' },
);

const MODULE_DEALS = module(
  'module-deals',
  'sales-pipeline',
  'Sales Pipeline',
  '/dept/sales/sales-pipeline',
  'deals',
  { id: SALES, key: 'sales', name: 'Sales' },
  'KANBAN_BOARD',
);

const MODULE_DOCUMENTS = module(
  'module-documents',
  'documents',
  'Documents',
  '/dept/sales/documents',
  null,
  { id: SALES, key: 'sales', name: 'Sales' },
  'DOCUMENT_HUB',
);

const MODULE_TASKS = module(
  'module-tasks',
  'project-management',
  'Project Management',
  '/dept/operations/project-management',
  'tasks',
  { id: OPERATIONS, key: 'operations', name: 'Operations' },
  'KANBAN_BOARD',
);

interface Fixtures {
  contacts?: Record<string, unknown>[];
  deals?: Record<string, unknown>[];
  tasks?: Record<string, unknown>[];
  documents?: Record<string, unknown>[];
  departments?: Record<string, unknown>[];
  counts?: Array<Record<string, unknown>>;
}

function createHarness(
  accessible: AccessibleModule[],
  fixtures: Fixtures = {},
) {
  const calls = {
    modules: 0,
    contacts: 0,
    deals: 0,
    tasks: 0,
    documents: 0,
    departments: 0,
  };

  const tx = {
    module: {
      findMany: jest.fn(async () => {
        calls.modules += 1;
        return accessible.map((entry) => ({
          id: entry.id,
          key: entry.key,
          name: entry.name,
          path: entry.path,
          type: entry.type,
          targetEntity: entry.targetEntity ?? null,
          dataScope: null,
          departmentId: entry.department?.id ?? null,
          department: entry.department
            ? {
                id: entry.department.id,
                key: entry.department.key,
                name: entry.department.name,
              }
            : null,
        }));
      }),
    },
    contact: {
      findMany: jest.fn(async () => {
        calls.contacts += 1;
        return fixtures.contacts ?? [];
      }),
    },
    deal: {
      findMany: jest.fn(async () => {
        calls.deals += 1;
        return fixtures.deals ?? [];
      }),
    },
    task: {
      findMany: jest.fn(async () => {
        calls.tasks += 1;
        return fixtures.tasks ?? [];
      }),
    },
    document: {
      findMany: jest.fn(async () => {
        calls.documents += 1;
        return fixtures.documents ?? [];
      }),
    },
    department: {
      findMany: jest.fn(async () => {
        calls.departments += 1;
        return fixtures.departments ?? [];
      }),
    },
    user: {
      groupBy: jest.fn(async () => fixtures.counts ?? []),
    },
  };

  const prisma = {
    withTenant: jest.fn(
      async (_tenantId: string, work: (client: typeof tx) => unknown) =>
        work(tx),
    ),
  };

  const adapter = {
    getAccessibleModules: jest.fn(async () => accessible),
  };

  const service = new SearchService(
    prisma as unknown as PrismaService,
    adapter as never,
    new EntityRegistryService(),
    new ScopeFilterService(prisma as unknown as PrismaService),
  );

  return { service, adapter, prisma, tx, calls };
}

function contact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contact-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    company: 'Acme',
    email: 'ada@acme.test',
    deletedAt: null,
    updatedAt: new Date('2026-01-02T03:04:05.000Z'),
    ...overrides,
  };
}

function firstArg(mock: jest.Mock): any {
  return (mock.mock.calls as unknown[][])[0]?.[0];
}

describe('SearchService', () => {
  it('rejects a query shorter than two characters', async () => {
    const { service } = createHarness([MODULE_CONTACTS]);

    await expect(service.search(ADMIN as never, { q: 'a' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('groups scoped records, departments and documents', async () => {
    const { service } = createHarness([MODULE_CONTACTS, MODULE_DOCUMENTS], {
      contacts: [contact()],
      documents: [
        {
          id: 'doc-1',
          title: 'Sales playbook',
          status: 'PUBLISHED',
          category: 'SOPs',
          updatedAt: new Date('2026-02-03T00:00:00.000Z'),
        },
      ],
      departments: [
        { id: SALES, key: 'sales', name: 'Sales' },
        { id: OPERATIONS, key: 'operations', name: 'Operations' },
      ],
      counts: [
        { departmentId: SALES, _count: { _all: 12 } },
        { departmentId: OPERATIONS, _count: { _all: 1 } },
      ],
    });

    const result = await service.search(ADMIN as never, { q: 'sa' });

    const records = result.groups.find((group) => group.type === 'record');
    expect(records).toMatchObject({
      moduleKey: 'contacts',
      deptKey: 'sales',
      moduleName: 'Contacts',
    });
    expect(records?.items).toEqual([
      {
        id: 'contact-1',
        title: 'Ada Lovelace',
        subtitle: 'Acme',
        updatedAt: '2026-01-02T03:04:05.000Z',
        href: '/dept/sales/contacts?open=contact-1',
      },
    ]);

    const departments = result.groups.find(
      (group) => group.type === 'department',
    );
    expect(departments?.items).toEqual([
      {
        id: SALES,
        title: 'Sales',
        subtitle: '12 members',
        href: '/departments/sales',
      },
      {
        id: OPERATIONS,
        title: 'Operations',
        subtitle: '1 member',
        href: '/departments/operations',
      },
    ]);

    const documents = result.groups.find((group) => group.type === 'document');
    expect(documents?.items).toEqual([
      {
        id: 'doc-1',
        title: 'Sales playbook',
        subtitle: 'PUBLISHED · SOPs',
        updatedAt: '2026-02-03T00:00:00.000Z',
        href: '/dept/sales/documents',
      },
    ]);

    expect(result.query).toBe('sa');
    expect(typeof result.tookMs).toBe('number');
  });

  it('treats the limit as a per-group cap between one and five', async () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      contact({ id: `contact-${index}`, firstName: `Ada${index}` }),
    );
    const { service, tx } = createHarness([MODULE_CONTACTS], {
      contacts: many,
    });

    await service.search(ADMIN as never, { q: 'ada', limit: '99' });

    const args = firstArg(tx.contact.findMany) as { take: number };
    expect(args.take).toBe(5);
  });

  it('caps the response at 20 items while keeping groups represented', async () => {
    const accessible = [
      MODULE_CONTACTS,
      MODULE_DEALS,
      MODULE_TASKS,
      module(
        'module-contacts-2',
        'customers',
        'Customers',
        '/dept/sales/customers',
        'contacts',
        { id: SALES, key: 'sales', name: 'Sales' },
      ),
      module(
        'module-deals-2',
        'renewals',
        'Renewals',
        '/dept/sales/renewals',
        'deals',
        { id: SALES, key: 'sales', name: 'Sales' },
      ),
    ];

    const rows = (prefix: string) =>
      Array.from({ length: 5 }, (_, index) => ({
        ...contact({ id: `${prefix}-${index}` }),
      }));

    const { service, tx } = createHarness(accessible, {
      contacts: rows('contact'),
      deals: rows('deal'),
      tasks: rows('task'),
      departments: [],
    });
    // Both contacts modules share the `contact` delegate; return rows per call.
    tx.contact.findMany.mockImplementation(async () => rows('contact'));
    tx.deal.findMany.mockImplementation(async () => rows('deal'));
    tx.task.findMany.mockImplementation(async () => rows('task'));

    const result = await service.search(ADMIN as never, { q: 'ada' });
    const total = result.groups.reduce(
      (count, group) => count + group.items.length,
      0,
    );

    expect(total).toBe(20);
    expect(result.groups.length).toBe(5);
    for (const group of result.groups) {
      expect(group.items.length).toBeGreaterThan(0);
      expect(group.items.length).toBeLessThanOrEqual(5);
    }
  });

  it('coalesces identical queries inside the two-second window', async () => {
    const { service, adapter } = createHarness([MODULE_CONTACTS], {
      contacts: [contact()],
      departments: [],
    });

    const [first, second] = await Promise.all([
      service.search(ADMIN as never, { q: 'ada' }),
      service.search(ADMIN as never, { q: 'ada' }),
    ]);

    expect(first).toBe(second);
    expect(adapter.getAccessibleModules).toHaveBeenCalledTimes(1);
  });

  it('keeps the other sources when one source fails', async () => {
    const { service, tx } = createHarness([MODULE_CONTACTS, MODULE_DEALS], {
      deals: [
        {
          id: 'deal-1',
          name: 'Apollo',
          amount: 100,
          status: 'LEAD',
          deletedAt: null,
          updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ],
      departments: [],
    });
    tx.contact.findMany.mockRejectedValue(new Error('scope exploded'));

    const result = await service.search(ADMIN as never, { q: 'ap' });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      type: 'record',
      moduleKey: 'sales-pipeline',
    });
    expect(result.groups[0].items[0].title).toBe('Apollo');
  });

  it('restricts department hits to departments with visible modules for staff', async () => {
    const staff = {
      id: 'user-staff',
      role: 'STAFF',
      tenantId: TENANT,
      dataScope: 'SELF',
      departmentId: SALES,
      managedDepartmentId: null,
      isTenantAdmin: false,
    };
    // `contacts` has `selfField`, so SELF scope resolves without extra queries.
    const { service, tx } = createHarness([MODULE_CONTACTS], {
      contacts: [contact({ userId: 'user-staff' })],
      departments: [{ id: SALES, key: 'sales', name: 'Sales' }],
    });

    await service.search(staff as never, { q: 'sa' });

    const args = firstArg(tx.department.findMany) as {
      where: { id?: { in: string[] } };
    };
    expect(args.where.id).toEqual({ in: [SALES] });
  });

  it('applies the caller scope to record queries', async () => {
    const staff = {
      id: 'user-staff',
      role: 'STAFF',
      tenantId: TENANT,
      dataScope: 'SELF',
      departmentId: SALES,
      managedDepartmentId: null,
      isTenantAdmin: false,
    };
    const { service, tx } = createHarness([MODULE_CONTACTS], {
      contacts: [contact({ userId: 'user-staff' })],
      departments: [],
    });

    await service.search(staff as never, { q: 'ada' });

    const args = firstArg(tx.contact.findMany) as {
      where: { AND: Array<Record<string, unknown>> };
    };
    expect(args.where.AND).toContainEqual({ userId: 'user-staff' });
    expect(args.where.AND).toContainEqual({ deletedAt: null });
    expect(args.where.AND).toContainEqual({
      OR: expect.arrayContaining([
        { firstName: { contains: 'ada', mode: 'insensitive' } },
      ]),
    });
  });

  it('scopes documents to the caller department unless tenant-wide', async () => {
    const { service, tx } = createHarness([MODULE_DOCUMENTS], {
      documents: [],
      departments: [],
    });

    await service.search(ADMIN as never, { q: 'play' });

    const args = firstArg(tx.document.findMany) as {
      where: { AND: Array<Record<string, unknown>> };
    };
    expect(args.where.AND[0]).toEqual({ tenantId: TENANT });
    expect(args.where.AND).toContainEqual({ deletedAt: null });
    expect(args.where.AND).toContainEqual({ status: { not: 'ARCHIVED' } });
  });
});

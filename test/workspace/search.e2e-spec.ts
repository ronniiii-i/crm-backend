// test/workspace/search.e2e-spec.ts
//
// Stage 8: global command-palette search.
//
// The real controller, search service, ACL adapter and scope filter run against
// the in-memory Prisma double. The fixtures cover record, department and
// document groups, plus SELF/TENANT scoping, soft deletes, inactive modules and
// tenant isolation.

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PermissionType } from '@prisma/client';
import * as request from 'supertest';

import { CacheService } from '../../src/cache/cache.service';
import { FrontendAdapterService } from '../../src/auth/frontend-adapter.service';
import { PermissionResolutionService } from '../../src/auth/services/permission-resolution.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SearchController } from '../../src/workspace/controllers/search.controller';
import { EntityRegistryService } from '../../src/workspace/services/entity-registry.service';
import { ScopeFilterService } from '../../src/workspace/services/scope-filter.service';
import { SearchService } from '../../src/workspace/services/search.service';
import {
  WorkspaceState,
  createFakeWorkspacePrisma,
  emptyWorkspaceState,
} from '../utils/workspace-prisma';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const DEPT_SALES = 'aaaaaaaa-0000-4000-8000-000000000001';
const DEPT_OPERATIONS = 'aaaaaaaa-0000-4000-8000-000000000002';
const DEPT_FINANCE_B = 'bbbbbbbb-0000-4000-8000-000000000001';

const MODULE_CONTACTS = 'cccccccc-0000-4000-8000-000000000001';
const MODULE_ARCHIVE = 'cccccccc-0000-4000-8000-000000000002';
const MODULE_TASKS = 'cccccccc-0000-4000-8000-000000000003';
const MODULE_DOCUMENTS = 'cccccccc-0000-4000-8000-000000000004';

const ACTOR_ADMIN = {
  id: 'user-admin',
  role: 'ADMIN',
  tenantId: TENANT_A,
  roleId: 'role-admin',
  dataScope: 'TENANT',
  departmentId: DEPT_SALES,
  managedDepartmentId: null,
  isTenantAdmin: true,
};

const ACTOR_STAFF = {
  id: 'user-staff',
  role: 'STAFF',
  tenantId: TENANT_A,
  roleId: 'role-staff',
  dataScope: 'SELF',
  departmentId: DEPT_SALES,
  managedDepartmentId: null,
  isTenantAdmin: false,
};

const PERMISSIONS: Record<string, Record<string, PermissionType[]>> = {
  ADMIN: {
    [MODULE_CONTACTS]: [PermissionType.VIEW],
    [MODULE_ARCHIVE]: [PermissionType.VIEW],
    [MODULE_TASKS]: [PermissionType.VIEW],
    [MODULE_DOCUMENTS]: [PermissionType.VIEW],
  },
  STAFF: {
    [MODULE_CONTACTS]: [PermissionType.VIEW],
    [MODULE_DOCUMENTS]: [PermissionType.VIEW],
  },
};

function buildState(): WorkspaceState {
  const sales = {
    id: DEPT_SALES,
    tenantId: TENANT_A,
    key: 'sales',
    name: 'Sales',
    sortOrder: 1,
  };
  const operations = {
    id: DEPT_OPERATIONS,
    tenantId: TENANT_A,
    key: 'operations',
    name: 'Operations',
    sortOrder: 2,
  };
  const financeB = {
    id: DEPT_FINANCE_B,
    tenantId: TENANT_B,
    key: 'finance',
    name: 'Finance',
    sortOrder: 1,
  };

  const state = emptyWorkspaceState();

  state.departments = [sales, operations, financeB];

  state.modules = [
    {
      id: MODULE_CONTACTS,
      tenantId: TENANT_A,
      key: 'contacts',
      name: 'Contacts',
      path: '/dept/sales/contacts',
      icon: null,
      group: 'Sales',
      order: 1,
      isNavigable: true,
      description: 'Contacts',
      type: 'DATA_TABLE',
      targetEntity: 'contacts',
      config: {},
      dataScope: null,
      isActive: true,
      departmentId: DEPT_SALES,
      department: sales,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: MODULE_ARCHIVE,
      tenantId: TENANT_A,
      key: 'archived-contacts',
      name: 'Archived contacts',
      path: '/dept/sales/archived-contacts',
      icon: null,
      group: 'Sales',
      order: 2,
      isNavigable: false,
      description: 'Inactive module',
      type: 'DATA_TABLE',
      targetEntity: 'contacts',
      config: {},
      dataScope: null,
      isActive: false,
      departmentId: DEPT_SALES,
      department: sales,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: MODULE_TASKS,
      tenantId: TENANT_A,
      key: 'project-management',
      name: 'Project Management',
      path: '/dept/operations/project-management',
      icon: null,
      group: 'Operations',
      order: 1,
      isNavigable: true,
      description: 'Tasks',
      type: 'KANBAN_BOARD',
      targetEntity: 'tasks',
      config: {},
      dataScope: null,
      isActive: true,
      departmentId: DEPT_OPERATIONS,
      department: operations,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: MODULE_DOCUMENTS,
      tenantId: TENANT_A,
      key: 'documents',
      name: 'Documents',
      path: '/dept/sales/documents',
      icon: null,
      group: 'Sales',
      order: 3,
      isNavigable: true,
      description: 'Document hub',
      type: 'DOCUMENT_HUB',
      targetEntity: null,
      config: {},
      dataScope: null,
      isActive: true,
      departmentId: DEPT_SALES,
      department: sales,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  state.users = [
    {
      id: 'user-admin',
      tenantId: TENANT_A,
      name: 'Ada Admin',
      email: 'admin@acme.test',
      status: 'ACTIVE',
      departmentId: DEPT_SALES,
    },
    {
      id: 'user-staff',
      tenantId: TENANT_A,
      name: 'Sam Staff',
      email: 'sam@acme.test',
      status: 'ACTIVE',
      departmentId: DEPT_SALES,
    },
    {
      id: 'user-colleague',
      tenantId: TENANT_A,
      name: 'Gina Colleague',
      email: 'gina@acme.test',
      status: 'ACTIVE',
      departmentId: DEPT_SALES,
    },
    {
      id: 'user-beta',
      tenantId: TENANT_B,
      name: 'Bea Beta',
      email: 'bea@beta.test',
      status: 'ACTIVE',
      departmentId: DEPT_FINANCE_B,
    },
  ];

  state.contacts = [
    {
      id: 'eeeeeeee-0000-4000-8000-000000000001',
      tenantId: TENANT_A,
      firstName: 'Ada',
      lastName: 'Lovelace',
      company: 'Acme',
      email: 'ada@acme.test',
      userId: 'user-staff',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    },
    {
      id: 'eeeeeeee-0000-4000-8000-000000000002',
      tenantId: TENANT_A,
      firstName: 'Grace',
      lastName: 'Hopper',
      company: 'Acme',
      email: 'grace@acme.test',
      userId: 'user-colleague',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    },
    {
      id: 'eeeeeeee-0000-4000-8000-000000000003',
      tenantId: TENANT_A,
      firstName: 'Deleted',
      lastName: 'Contact',
      company: 'Acme',
      email: 'deleted@acme.test',
      userId: 'user-staff',
      deletedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'eeeeeeee-0000-4000-8000-000000000004',
      tenantId: TENANT_B,
      firstName: 'Beta',
      lastName: 'Contact',
      company: 'Beta Co',
      email: 'beta@beta.test',
      userId: 'user-beta',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  state.tasks = [
    {
      id: 'ffffffff-0000-4000-8000-000000000001',
      tenantId: TENANT_A,
      title: 'Apollo rollout',
      description: 'Release Apollo',
      status: 'Todo',
      priority: 1,
      assignedToId: 'user-staff',
      projectId: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'ffffffff-0000-4000-8000-000000000002',
      tenantId: TENANT_A,
      title: 'Apollo review',
      description: 'Review Apollo',
      status: 'In Progress',
      priority: 2,
      assignedToId: 'user-colleague',
      projectId: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  state.documents = [
    {
      id: '99999999-0000-4000-8000-000000000001',
      tenantId: TENANT_A,
      moduleId: MODULE_DOCUMENTS,
      departmentId: DEPT_SALES,
      title: 'Sales playbook',
      slug: 'sales-playbook',
      format: 'MARKDOWN',
      status: 'PUBLISHED',
      category: 'SOPs',
      content: 'How to sell',
      version: 1,
      createdById: 'user-admin',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    },
    {
      id: '99999999-0000-4000-8000-000000000002',
      tenantId: TENANT_A,
      moduleId: MODULE_DOCUMENTS,
      departmentId: null,
      title: 'Global playbook',
      slug: 'global-playbook',
      format: 'MARKDOWN',
      status: 'PUBLISHED',
      category: 'Policies',
      content: 'Company-wide playbook',
      version: 1,
      createdById: 'user-admin',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date('2026-02-02T00:00:00.000Z'),
    },
    {
      id: '99999999-0000-4000-8000-000000000003',
      tenantId: TENANT_A,
      moduleId: MODULE_DOCUMENTS,
      departmentId: DEPT_OPERATIONS,
      title: 'Ops playbook',
      slug: 'ops-playbook',
      format: 'MARKDOWN',
      status: 'PUBLISHED',
      category: 'SOPs',
      content: 'Operations playbook',
      version: 1,
      createdById: 'user-admin',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date('2026-02-03T00:00:00.000Z'),
    },
    {
      id: '99999999-0000-4000-8000-000000000004',
      tenantId: TENANT_B,
      moduleId: MODULE_DOCUMENTS,
      departmentId: DEPT_FINANCE_B,
      title: 'Beta playbook',
      slug: 'beta-playbook',
      format: 'MARKDOWN',
      status: 'PUBLISHED',
      category: 'SOPs',
      content: 'Beta',
      version: 1,
      createdById: 'user-beta',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  return state;
}

describe('Workspace search (Stage 8)', () => {
  let app: INestApplication;
  let state: WorkspaceState;

  const as = (
    test: request.Test,
    actor: Record<string, unknown> = ACTOR_ADMIN,
  ) => test.set('x-test-user', JSON.stringify(actor));

  beforeEach(async () => {
    state = buildState();
    const prisma = createFakeWorkspacePrisma(state);

    const cache = {
      tenantKey: (key: string, tenantId?: string) =>
        tenantId ? `${tenantId}:${key}` : key,
      get: async () => null,
      set: async () => undefined,
      invalidateUser: async () => undefined,
      invalidatePattern: async () => undefined,
      flushTenant: async () => undefined,
    };

    const permissions = {
      getEffectivePermissions: async (user: { role?: string }) => {
        const map = new Map<string, Set<PermissionType>>();
        for (const [moduleId, actions] of Object.entries(
          PERMISSIONS[user.role ?? ''] ?? {},
        )) {
          map.set(moduleId, new Set(actions));
        }
        return map;
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        SearchService,
        EntityRegistryService,
        ScopeFilterService,
        FrontendAdapterService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cache },
        { provide: PermissionResolutionService, useValue: permissions },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    (app as any).use((req: any, _res: any, next: any) => {
      const raw = req.headers['x-test-user'];
      if (raw) req.user = JSON.parse(raw);
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('rejects a one-character query with a stable error code', async () => {
    const response = await as(request(server()).get('/workspace/search?q=a'));

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('SEARCH_QUERY_TOO_SHORT');
  });

  it('marks responses as non-cacheable', async () => {
    const response = await as(
      request(server()).get('/workspace/search?q=acme'),
    );

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns scoped record groups for tenant-wide callers', async () => {
    const response = await as(
      request(server()).get('/workspace/search?q=acme'),
    );

    expect(response.status).toBe(200);
    expect(response.body.query).toBe('acme');

    const records = response.body.groups.filter(
      (group: { type: string }) => group.type === 'record',
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      moduleKey: 'contacts',
      deptKey: 'sales',
      moduleName: 'Contacts',
    });
    expect(
      records[0].items.map((item: { title: string }) => item.title),
    ).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect(records[0].items[0]).toMatchObject({
      subtitle: 'Acme',
      href: expect.stringContaining('/dept/sales/contacts?open='),
    });
    expect(
      records[0].items.some((item: { title: string }) =>
        item.title.includes('Deleted'),
      ),
    ).toBe(false);
  });

  it('limits SELF-scoped staff to their own records and visible departments', async () => {
    const response = await as(
      request(server()).get('/workspace/search?q=acme'),
      ACTOR_STAFF,
    );

    expect(response.status).toBe(200);
    const records = response.body.groups.filter(
      (group: { type: string }) => group.type === 'record',
    );
    expect(records).toHaveLength(1);
    expect(records[0].items).toHaveLength(1);
    expect(records[0].items[0].title).toBe('Ada Lovelace');
  });

  it('hides modules the caller cannot view', async () => {
    const tasks = await as(
      request(server()).get('/workspace/search?q=apollo'),
      ACTOR_STAFF,
    );
    expect(tasks.status).toBe(200);
    expect(tasks.body.groups).toEqual([]);

    const admin = await as(request(server()).get('/workspace/search?q=apollo'));
    const recordGroups = admin.body.groups.filter(
      (group: { type: string }) => group.type === 'record',
    );
    expect(recordGroups).toHaveLength(1);
    expect(recordGroups[0].moduleKey).toBe('project-management');
    expect(recordGroups[0].items).toHaveLength(2);
  });

  it('excludes inactive modules', async () => {
    const response = await as(
      request(server()).get('/workspace/search?q=acme'),
    );

    const moduleKeys = response.body.groups
      .filter((group: { type: string }) => group.type === 'record')
      .map((group: { moduleKey: string }) => group.moduleKey);
    expect(moduleKeys).toEqual(['contacts']);
  });

  it('returns departments with member counts', async () => {
    const response = await as(
      request(server()).get('/workspace/search?q=sales'),
    );

    const departments = response.body.groups.find(
      (group: { type: string }) => group.type === 'department',
    );
    expect(departments.items).toEqual([
      {
        id: DEPT_SALES,
        title: 'Sales',
        subtitle: '3 members',
        href: '/departments/sales',
      },
    ]);
  });

  it('applies document department scope and hides archived documents', async () => {
    state.documents.push({
      id: '99999999-0000-4000-8000-000000000005',
      tenantId: TENANT_A,
      moduleId: MODULE_DOCUMENTS,
      departmentId: DEPT_SALES,
      title: 'Archived playbook',
      slug: 'archived-playbook',
      format: 'MARKDOWN',
      status: 'ARCHIVED',
      category: 'SOPs',
      content: 'Old',
      version: 1,
      createdById: 'user-admin',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const admin = await as(
      request(server()).get('/workspace/search?q=playbook'),
    );
    const adminDocs = admin.body.groups.find(
      (group: { type: string }) => group.type === 'document',
    );
    expect(
      adminDocs.items.map((item: { title: string }) => item.title),
    ).toEqual(['Ops playbook', 'Global playbook', 'Sales playbook']);
    expect(adminDocs.items[0].href).toBe('/dept/sales/documents');

    const staff = await as(
      request(server()).get('/workspace/search?q=playbook'),
      ACTOR_STAFF,
    );
    const staffDocs = staff.body.groups.find(
      (group: { type: string }) => group.type === 'document',
    );
    expect(
      staffDocs.items.map((item: { title: string }) => item.title),
    ).toEqual(['Global playbook', 'Sales playbook']);
  });

  it('never leaks another tenant', async () => {
    const response = await as(
      request(server()).get('/workspace/search?q=beta'),
    );

    expect(response.status).toBe(200);
    expect(response.body.groups).toEqual([]);
  });

  it('caps the requested limit per group', async () => {
    const response = await as(
      request(server()).get('/workspace/search?q=acme&limit=1'),
    );

    const records = response.body.groups.find(
      (group: { type: string }) => group.type === 'record',
    );
    expect(records.items).toHaveLength(1);
  });
});

// test/workspace/workspace-api.e2e-spec.ts
//
// HTTP-level tests for the Stage 3 workspace API. The Nest application is
// built from the real workspace controllers, guard and services; only Prisma
// and the ACL resolver are replaced with in-memory doubles. A header-driven
// middleware supplies `request.user`, exactly as `JwtAuthGuard` would after
// authentication.
//
// Covered: module definitions, records CRUD, scope isolation (TENANT /
// DEPARTMENT / TEAM / SELF), cross-tenant isolation, allowlist rejection,
// kanban transitions, batched aggregates, config validation, document
// versioning/archiving and form submissions with entity mirroring.

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PermissionType } from '@prisma/client';
import * as request from 'supertest';

import { PrismaService } from '../../src/prisma/prisma.service';
import { CacheService } from '../../src/cache/cache.service';
import { PermissionResolutionService } from '../../src/auth/services/permission-resolution.service';
import { WorkspaceController } from '../../src/workspace/workspace.controller';
import { AggregateController } from '../../src/workspace/controllers/aggregate.controller';
import { CatalogController } from '../../src/workspace/controllers/catalog.controller';
import { DocumentsController } from '../../src/workspace/controllers/documents.controller';
import { RecordsController } from '../../src/workspace/controllers/records.controller';
import { SubmissionsController } from '../../src/workspace/controllers/submissions.controller';
import { ModulePermissionGuard } from '../../src/workspace/guards/module-permission.guard';
import { AggregationService } from '../../src/workspace/services/aggregation.service';
import { AuditService } from '../../src/workspace/services/audit.service';
import { DocumentService } from '../../src/workspace/services/document.service';
import { EntityQueryService } from '../../src/workspace/services/entity-query.service';
import { EntityRegistryService } from '../../src/workspace/services/entity-registry.service';
import { EntityWriteService } from '../../src/workspace/services/entity-write.service';
import { FormSubmissionService } from '../../src/workspace/services/form-submission.service';
import { ModuleAccessService } from '../../src/workspace/services/module-access.service';
import { ModuleConfigService } from '../../src/workspace/services/module-config.service';
import { ScopeFilterService } from '../../src/workspace/services/scope-filter.service';
import {
  WorkspaceState,
  createFakeWorkspacePrisma,
  emptyWorkspaceState,
} from '../utils/workspace-prisma';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const DEPT_FINANCE = 'aaaaaaaa-0000-4000-8000-000000000001';
const DEPT_SALES = 'aaaaaaaa-0000-4000-8000-000000000002';
const DEPT_HR = 'aaaaaaaa-0000-4000-8000-000000000003';
const DEPT_FINANCE_B = 'bbbbbbbb-0000-4000-8000-000000000001';

const MODULE_CONTACTS = 'cccccccc-0000-4000-8000-000000000001';
const MODULE_DEALS = 'cccccccc-0000-4000-8000-000000000002';
const MODULE_DASHBOARD = 'cccccccc-0000-4000-8000-000000000003';
const MODULE_DOCS = 'cccccccc-0000-4000-8000-000000000004';
const MODULE_FORMS = 'cccccccc-0000-4000-8000-000000000005';
const MODULE_USERS = 'cccccccc-0000-4000-8000-000000000006';
const MODULE_CONTACTS_B = 'dddddddd-0000-4000-8000-000000000001';

const CONTACT_FINANCE = 'eeeeeeee-0000-4000-8000-000000000001';
const CONTACT_SALES = 'eeeeeeee-0000-4000-8000-000000000002';
const CONTACT_TENANT_B = 'eeeeeeee-0000-4000-8000-000000000003';
const DEAL_LEAD_1 = 'ffffffff-0000-4000-8000-000000000001';
const DEAL_LEAD_2 = 'ffffffff-0000-4000-8000-000000000002';
const DEAL_WON = 'ffffffff-0000-4000-8000-000000000003';
const DOC_FINANCE = '99999999-0000-4000-8000-000000000001';

const ACTOR_ADMIN = {
  id: 'user-admin',
  tenantId: TENANT_A,
  roleId: 'role-admin',
  dataScope: 'TENANT',
  departmentId: DEPT_FINANCE,
  managedDepartmentId: null,
  isTenantAdmin: true,
};

const ACTOR_HOD = {
  id: 'user-hod',
  tenantId: TENANT_A,
  roleId: 'role-hod',
  dataScope: 'DEPARTMENT',
  departmentId: DEPT_FINANCE,
  managedDepartmentId: DEPT_FINANCE,
  isTenantAdmin: false,
};

const ACTOR_STAFF = {
  id: 'user-staff',
  tenantId: TENANT_A,
  roleId: 'role-staff',
  dataScope: 'SELF',
  departmentId: DEPT_SALES,
  managedDepartmentId: null,
  isTenantAdmin: false,
};

const ACTOR_LEAD = {
  id: 'user-lead',
  tenantId: TENANT_A,
  roleId: 'role-lead',
  dataScope: 'TEAM',
  departmentId: DEPT_SALES,
  managedDepartmentId: null,
  isTenantAdmin: false,
};

const ACTOR_ADMIN_B = {
  id: 'user-admin-b',
  tenantId: TENANT_B,
  roleId: 'role-admin',
  dataScope: 'TENANT',
  departmentId: DEPT_FINANCE_B,
  managedDepartmentId: null,
  isTenantAdmin: true,
};

const PERMISSIONS: Record<string, Record<string, PermissionType[]>> = {
  'role-hod': {
    [MODULE_CONTACTS]: [PermissionType.VIEW],
    [MODULE_DASHBOARD]: [PermissionType.VIEW],
    [MODULE_DOCS]: [PermissionType.VIEW],
  },
  'role-staff': {
    [MODULE_CONTACTS]: [PermissionType.VIEW],
    [MODULE_DOCS]: [
      PermissionType.VIEW,
      PermissionType.CREATE,
      PermissionType.EDIT,
      PermissionType.DELETE,
    ],
    [MODULE_FORMS]: [PermissionType.VIEW, PermissionType.CREATE],
  },
  'role-lead': {
    [MODULE_CONTACTS]: [PermissionType.VIEW],
  },
};

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function moduleRow(params: {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  department: { id: string; key: string; name: string };
  type: string;
  targetEntity: string | null;
  config?: Record<string, unknown>;
}): Record<string, any> {
  return {
    id: params.id,
    tenantId: params.tenantId,
    key: params.key,
    name: params.name,
    path: `/dept/${params.department.key}/${params.key}`,
    icon: null,
    group: params.department.name,
    order: 1,
    isNavigable: true,
    description: `${params.name} module`,
    type: params.type,
    targetEntity: params.targetEntity,
    config: params.config ?? {},
    dataScope: null,
    isActive: true,
    departmentId: params.department.id,
    department: params.department,
    createdAt: daysAgo(30),
    updatedAt: daysAgo(1),
  };
}

function buildState(): WorkspaceState {
  const finance = {
    id: DEPT_FINANCE,
    tenantId: TENANT_A,
    key: 'finance',
    name: 'Finance',
    sortOrder: 1,
  };
  const sales = {
    id: DEPT_SALES,
    tenantId: TENANT_A,
    key: 'sales',
    name: 'Sales',
    sortOrder: 2,
  };
  const hr = {
    id: DEPT_HR,
    tenantId: TENANT_A,
    key: 'hr',
    name: 'Human Resources',
    sortOrder: 3,
  };
  const financeB = {
    id: DEPT_FINANCE_B,
    tenantId: TENANT_B,
    key: 'finance',
    name: 'Finance',
    sortOrder: 1,
  };

  const salesTeam = {
    id: 'bbbbbbbb-0000-4000-8000-000000000002',
    tenantId: TENANT_A,
    name: 'Sales pod',
    departmentId: DEPT_SALES,
    leadUserId: 'user-lead',
    members: [{ userId: 'user-staff' }],
    createdAt: daysAgo(30),
  };

  const claimsFormConfig = {
    version: 1,
    entity: 'expenses',
    mode: 'create',
    fields: [
      {
        name: 'description',
        label: 'Description',
        type: 'text',
        required: true,
        mapTo: 'column',
      },
      {
        name: 'amount',
        label: 'Amount',
        type: 'currency',
        required: true,
        mapTo: 'column',
      },
      {
        name: 'category',
        label: 'Category',
        type: 'select',
        required: true,
        options: ['Travel', 'Software', 'Office', 'Marketing'],
        mapTo: 'column',
      },
    ],
    submitLabel: 'Submit claim',
    successMessage: 'Claim submitted.',
  };

  return {
    ...emptyWorkspaceState(),

    departments: [finance, sales, hr, financeB],

    users: [
      {
        id: 'user-admin',
        tenantId: TENANT_A,
        name: 'Ada Admin',
        email: 'admin@acme.test',
        status: 'ACTIVE',
        departmentId: DEPT_FINANCE,
        roleId: 'role-admin',
        isVerified: true,
        createdAt: daysAgo(30),
        updatedAt: daysAgo(1),
      },
      {
        id: 'user-staff',
        tenantId: TENANT_A,
        name: 'Sam Staff',
        email: 'staff@acme.test',
        status: 'ACTIVE',
        departmentId: DEPT_SALES,
        roleId: 'role-staff',
        isVerified: true,
        createdAt: daysAgo(30),
        updatedAt: daysAgo(1),
      },
    ],

    teams: [salesTeam],

    teamMembers: [
      {
        id: 'bbbbbbbb-0000-4000-8000-000000000003',
        tenantId: TENANT_A,
        teamId: salesTeam.id,
        userId: 'user-staff',
        role: 'Member',
      },
    ],

    modules: [
      moduleRow({
        id: MODULE_CONTACTS,
        tenantId: TENANT_A,
        key: 'contacts',
        name: 'Contacts',
        department: finance,
        type: 'DATA_TABLE',
        targetEntity: 'contacts',
      }),
      moduleRow({
        id: MODULE_DEALS,
        tenantId: TENANT_A,
        key: 'deals',
        name: 'Deals',
        department: sales,
        type: 'KANBAN_BOARD',
        targetEntity: 'deals',
        config: {
          version: 1,
          entity: 'deals',
          statusField: 'status',
          columns: [
            { value: 'LEAD', label: 'Lead', color: 'slate' },
            { value: 'QUALIFIED', label: 'Qualified', color: 'blue' },
            { value: 'PROPOSAL', label: 'Proposal', color: 'violet' },
            { value: 'NEGOTIATION', label: 'Negotiation', color: 'amber' },
            { value: 'WON', label: 'Won', color: 'emerald' },
          ],
          secondaryColumns: [{ value: 'LOST', label: 'Lost', color: 'rose' }],
          titleField: 'name',
          valueField: 'amount',
          assigneeField: 'userId',
          dueField: 'closeDate',
          allowCreate: true,
          allowMove: true,
        },
      }),
      moduleRow({
        id: MODULE_DASHBOARD,
        tenantId: TENANT_A,
        key: 'finance-overview',
        name: 'Finance overview',
        department: finance,
        type: 'DASHBOARD_VIEW',
        targetEntity: null,
        config: { version: 1, layout: 'grid', columns: 12, widgets: [] },
      }),
      moduleRow({
        id: MODULE_DOCS,
        tenantId: TENANT_A,
        key: 'policies',
        name: 'Policies',
        department: finance,
        type: 'DOCUMENT_HUB',
        targetEntity: null,
        config: {
          version: 1,
          categories: ['Policies', 'SOPs'],
          defaultFormat: 'MARKDOWN',
          allowCreate: true,
          allowRichText: true,
        },
      }),
      moduleRow({
        id: MODULE_FORMS,
        tenantId: TENANT_A,
        key: 'expense-claims',
        name: 'Expense claims',
        department: hr,
        type: 'FORM_BUILDER',
        targetEntity: 'expenses',
        config: claimsFormConfig,
      }),
      moduleRow({
        id: MODULE_USERS,
        tenantId: TENANT_A,
        key: 'user-management',
        name: 'User management',
        department: finance,
        type: 'DATA_TABLE',
        targetEntity: 'users',
      }),
      moduleRow({
        id: MODULE_CONTACTS_B,
        tenantId: TENANT_B,
        key: 'contacts',
        name: 'Contacts',
        department: financeB,
        type: 'DATA_TABLE',
        targetEntity: 'contacts',
      }),
    ],

    contacts: [
      {
        id: CONTACT_FINANCE,
        tenantId: TENANT_A,
        firstName: 'Fiona',
        lastName: 'Finance',
        email: 'fiona@acme.test',
        company: 'Acme Finance',
        status: 'Customer',
        userId: 'user-fin',
        createdBy: {
          id: 'user-fin',
          name: 'Fiona',
          departmentId: DEPT_FINANCE,
        },
        createdAt: daysAgo(20),
        updatedAt: daysAgo(20),
      },
      {
        id: CONTACT_SALES,
        tenantId: TENANT_A,
        firstName: 'Sam',
        lastName: 'Sales',
        email: 'sam@globex.test',
        company: 'Globex',
        status: 'Lead',
        userId: 'user-staff',
        createdBy: { id: 'user-staff', name: 'Sam', departmentId: DEPT_SALES },
        createdAt: daysAgo(10),
        updatedAt: daysAgo(10),
      },
      {
        id: CONTACT_TENANT_B,
        tenantId: TENANT_B,
        firstName: 'Bea',
        lastName: 'Beta',
        email: 'bea@beta.test',
        company: 'Beta Co',
        status: 'Lead',
        userId: 'user-admin-b',
        createdBy: {
          id: 'user-admin-b',
          name: 'Bea',
          departmentId: DEPT_FINANCE_B,
        },
        createdAt: daysAgo(10),
        updatedAt: daysAgo(10),
      },
    ],

    expenses: [
      {
        id: 'eeeeeeee-0000-4000-8000-000000000011',
        tenantId: TENANT_A,
        description: 'Flights',
        amount: 100,
        category: 'Travel',
        incurredAt: daysAgo(10),
        departmentId: DEPT_FINANCE,
        userId: 'user-fin',
        createdAt: daysAgo(10),
        updatedAt: daysAgo(10),
      },
      {
        id: 'eeeeeeee-0000-4000-8000-000000000012',
        tenantId: TENANT_A,
        description: 'Design tool',
        amount: 250,
        category: 'Software',
        incurredAt: daysAgo(5),
        departmentId: DEPT_FINANCE,
        userId: 'user-hod',
        createdAt: daysAgo(5),
        updatedAt: daysAgo(5),
      },
      {
        id: 'eeeeeeee-0000-4000-8000-000000000013',
        tenantId: TENANT_A,
        description: 'Old laptop',
        amount: 50,
        category: 'Office',
        incurredAt: daysAgo(200),
        departmentId: DEPT_FINANCE,
        userId: 'user-fin',
        createdAt: daysAgo(200),
        updatedAt: daysAgo(200),
      },
      {
        id: 'eeeeeeee-0000-4000-8000-000000000014',
        tenantId: TENANT_A,
        description: 'Ad campaign',
        amount: 999,
        category: 'Marketing',
        incurredAt: daysAgo(100),
        departmentId: DEPT_SALES,
        userId: 'user-staff',
        createdAt: daysAgo(100),
        updatedAt: daysAgo(100),
      },
    ],

    deals: [
      {
        id: DEAL_LEAD_1,
        tenantId: TENANT_A,
        name: 'Lead one',
        amount: 100,
        status: 'LEAD',
        contactId: CONTACT_SALES,
        userId: 'user-staff',
        assignedTo: { id: 'user-staff', departmentId: DEPT_SALES },
        closeDate: daysAgo(5),
        createdAt: daysAgo(15),
        updatedAt: daysAgo(5),
      },
      {
        id: DEAL_LEAD_2,
        tenantId: TENANT_A,
        name: 'Lead two',
        amount: 200,
        status: 'LEAD',
        contactId: CONTACT_SALES,
        userId: 'user-staff',
        assignedTo: { id: 'user-staff', departmentId: DEPT_SALES },
        closeDate: daysAgo(4),
        createdAt: daysAgo(14),
        updatedAt: daysAgo(4),
      },
      {
        id: DEAL_WON,
        tenantId: TENANT_A,
        name: 'Won deal',
        amount: 300,
        status: 'WON',
        contactId: CONTACT_SALES,
        userId: 'user-lead',
        assignedTo: { id: 'user-lead', departmentId: DEPT_SALES },
        closeDate: daysAgo(3),
        createdAt: daysAgo(13),
        updatedAt: daysAgo(3),
      },
    ],

    documents: [
      {
        id: DOC_FINANCE,
        tenantId: TENANT_A,
        departmentId: DEPT_FINANCE,
        moduleId: MODULE_DOCS,
        title: 'Finance policy',
        slug: 'finance-policy-abc123',
        format: 'MARKDOWN',
        status: 'PUBLISHED',
        category: 'Policies',
        content: '# Finance policy',
        version: 1,
        createdById: 'user-admin',
        createdAt: daysAgo(10),
        updatedAt: daysAgo(10),
      },
    ],

    auditLogs: [],
    invoices: [],
    inventoryItems: [],
    supportTickets: [],
    tasks: [],
    attendanceRecords: [],
    formSubmissions: [],
    projects: [],
  };
}

describe('Workspace API (Stage 3)', () => {
  let app: INestApplication;
  let state: WorkspaceState;

  const header = (actor: Record<string, unknown>) => JSON.stringify(actor);

  const as = (
    test: request.Test,
    actor: Record<string, unknown> = ACTOR_ADMIN,
  ) => test.set('x-test-user', header(actor));

  beforeEach(async () => {
    state = buildState();

    const prisma = createFakeWorkspacePrisma(state);
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
      controllers: [
        WorkspaceController,
        RecordsController,
        AggregateController,
        DocumentsController,
        SubmissionsController,
        CatalogController,
      ],
      providers: [
        EntityRegistryService,
        ScopeFilterService,
        ModuleConfigService,
        ModuleAccessService,
        AuditService,
        EntityQueryService,
        EntityWriteService,
        AggregationService,
        DocumentService,
        FormSubmissionService,
        ModulePermissionGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionResolutionService, useValue: permissions },
        { provide: CacheService, useValue: { flushTenant: jest.fn() } },
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

  describe('module definition', () => {
    it('returns config, actions, scope and entity meta', async () => {
      const response = await as(
        request(server()).get('/workspace/modules/finance/contacts'),
      );

      expect(response.status).toBe(200);
      expect(response.body.key).toBe('contacts');
      expect(response.body.department.key).toBe('finance');
      expect(response.body.actions).toEqual([
        'VIEW',
        'CREATE',
        'EDIT',
        'DELETE',
      ]);
      expect(response.body.dataScope).toBe('TENANT');
      expect(response.body.config.entity).toBe('contacts');
      expect(Array.isArray(response.body.entityMeta.fields)).toBe(true);
    });

    it('hides modules that are missing or in another department', async () => {
      const response = await as(
        request(server()).get('/workspace/modules/sales/contacts'),
      );
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('MODULE_NOT_FOUND');
    });

    it('denies a module the caller has no permission on', async () => {
      const response = await as(
        request(server()).get('/workspace/modules/finance/finance-overview'),
        ACTOR_STAFF,
      );
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MODULE_FORBIDDEN');
    });

    it('serves the entity catalog to any authenticated user', async () => {
      const response = await as(
        request(server()).get('/workspace/entity-catalog'),
      );
      expect(response.status).toBe(200);
      expect(response.body.entities.length).toBeGreaterThanOrEqual(10);
      expect(response.body.timeframes).toContain('LAST_30_DAYS');
    });
  });

  describe('records scope isolation', () => {
    it('TENANT sees every row in the tenant only', async () => {
      const response = await as(
        request(server()).get('/workspace/modules/finance/contacts/records'),
      );

      expect(response.status).toBe(200);
      expect(response.body.meta.total).toBe(2);
      expect(response.body.scope).toBe('TENANT');
      expect(
        response.body.data.every((row: any) => row.tenantId === TENANT_A),
      ).toBe(true);
    });

    it('DEPARTMENT sees only its department rows', async () => {
      const response = await as(
        request(server()).get('/workspace/modules/finance/contacts/records'),
        ACTOR_HOD,
      );

      expect(response.status).toBe(200);
      expect(response.body.scope).toBe('DEPARTMENT');
      expect(response.body.data.map((row: any) => row.id)).toEqual([
        CONTACT_FINANCE,
      ]);
    });

    it('SELF sees only rows owned by the caller', async () => {
      const response = await as(
        request(server()).get('/workspace/modules/finance/contacts/records'),
        ACTOR_STAFF,
      );

      expect(response.status).toBe(200);
      expect(response.body.scope).toBe('SELF');
      expect(response.body.data.map((row: any) => row.id)).toEqual([
        CONTACT_SALES,
      ]);
    });

    it('TEAM sees rows owned by team members', async () => {
      const response = await as(
        request(server()).get('/workspace/modules/finance/contacts/records'),
        ACTOR_LEAD,
      );

      expect(response.status).toBe(200);
      expect(response.body.scope).toBe('TEAM');
      expect(response.body.data.map((row: any) => row.id)).toEqual([
        CONTACT_SALES,
      ]);
    });

    it('never returns another tenant rows', async () => {
      const b = await as(
        request(server()).get('/workspace/modules/finance/contacts/records'),
        ACTOR_ADMIN_B,
      );

      expect(b.status).toBe(200);
      expect(b.body.meta.total).toBe(1);
      expect(b.body.data[0].tenantId).toBe(TENANT_B);

      const a = await as(
        request(server()).get('/workspace/modules/finance/contacts/records'),
      );
      expect(a.body.data.map((row: any) => row.id)).not.toContain(
        CONTACT_TENANT_B,
      );
    });
  });

  describe('records allowlist and CRUD', () => {
    it('rejects unknown sort, filter and include fields', async () => {
      const sort = await as(
        request(server()).get(
          '/workspace/modules/finance/contacts/records?sort=amount:asc',
        ),
      );
      expect(sort.status).toBe(400);
      expect(sort.body.code).toBe('UNKNOWN_SORT_FIELD');

      const filter = await as(
        request(server()).get(
          '/workspace/modules/finance/contacts/records?filter[nope]=x',
        ),
      );
      expect(filter.status).toBe(400);
      expect(filter.body.code).toBe('UNKNOWN_FILTER_FIELD');

      const include = await as(
        request(server()).get(
          '/workspace/modules/finance/contacts/records?include=bogus',
        ),
      );
      expect(include.status).toBe(400);
      expect(include.body.code).toBe('UNKNOWN_INCLUDE');
    });

    it('filters, searches and sorts on allowlisted fields', async () => {
      const filtered = await as(
        request(server()).get(
          '/workspace/modules/finance/contacts/records?filter[status]=Lead',
        ),
      );
      expect(filtered.body.meta.total).toBe(1);
      expect(filtered.body.data[0].id).toBe(CONTACT_SALES);

      const searched = await as(
        request(server()).get(
          '/workspace/modules/finance/contacts/records?search=globex',
        ),
      );
      expect(searched.body.meta.total).toBe(1);

      const sorted = await as(
        request(server()).get(
          '/workspace/modules/finance/contacts/records?sort=firstName:asc',
        ),
      );
      expect(sorted.body.data.map((row: any) => row.firstName)).toEqual([
        'Fiona',
        'Sam',
      ]);
    });

    it('creates, updates and deletes a record with audit rows', async () => {
      const created = await as(
        request(server())
          .post('/workspace/modules/finance/contacts/records')
          .send({
            firstName: 'New',
            lastName: 'Person',
            email: 'new@acme.test',
            company: 'Acme',
          }),
      );

      expect(created.status).toBe(201);
      expect(created.body.id).toBeTruthy();
      expect(created.body.userId).toBe('user-admin');
      expect(created.body.status).toBe('Lead');

      const createdAudit = state.auditLogs.find(
        (row) => row.action === 'CREATE' && row.entity === 'contacts',
      );
      expect(createdAudit?.entityId).toBe(created.body.id);

      const updated = await as(
        request(server())
          .patch(
            `/workspace/modules/finance/contacts/records/${created.body.id}`,
          )
          .send({ company: 'Renamed Ltd' }),
      );
      expect(updated.status).toBe(200);
      expect(updated.body.company).toBe('Renamed Ltd');

      const removed = await as(
        request(server()).delete(
          `/workspace/modules/finance/contacts/records/${created.body.id}`,
        ),
      );
      expect(removed.status).toBe(200);
      expect(removed.body).toEqual({ id: created.body.id, deleted: true });
    });

    it('rejects unknown and immutable write fields', async () => {
      const unknown = await as(
        request(server())
          .post('/workspace/modules/finance/contacts/records')
          .send({ firstName: 'A', lastName: 'B', nope: 'x' }),
      );
      expect(unknown.status).toBe(400);
      expect(unknown.body.code).toBe('UNKNOWN_FIELD');

      const immutable = await as(
        request(server())
          .patch(`/workspace/modules/finance/contacts/records/${CONTACT_SALES}`)
          .send({ tenantId: TENANT_B }),
      );
      expect(immutable.status).toBe(400);
      expect(immutable.body.code).toBe('IMMUTABLE_FIELD');
    });

    it('keeps read-only entities read-only', async () => {
      const response = await as(
        request(server())
          .post('/workspace/modules/finance/user-management/records')
          .send({ name: 'Nope' }),
      );

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MODULE_FORBIDDEN');
    });

    it('validates kanban transitions against configured columns', async () => {
      const won = await as(
        request(server())
          .post(
            `/workspace/modules/sales/deals/records/${DEAL_LEAD_1}/transition`,
          )
          .send({ status: 'WON' }),
      );
      expect(won.status).toBe(201);
      expect(won.body.status).toBe('WON');

      const invalid = await as(
        request(server())
          .post(
            `/workspace/modules/sales/deals/records/${DEAL_LEAD_2}/transition`,
          )
          .send({ status: 'NOPE' }),
      );
      expect(invalid.status).toBe(400);
      expect(invalid.body.code).toBe('INVALID_STATUS');
    });
  });

  describe('aggregation', () => {
    it('returns per-widget results and isolates widget errors', async () => {
      const response = await as(
        request(server())
          .post('/workspace/modules/finance/finance-overview/aggregate')
          .send({
            widgets: [
              {
                id: 'all-expenses',
                entity: 'expenses',
                aggregation: 'SUM',
                field: 'amount',
                timeframe: 'ALL',
              },
              {
                id: 'recent-expenses',
                entity: 'expenses',
                aggregation: 'SUM',
                field: 'amount',
                timeframe: 'LAST_30_DAYS',
              },
              {
                id: 'bad-field',
                entity: 'expenses',
                aggregation: 'SUM',
                field: 'description',
                timeframe: 'ALL',
              },
              {
                id: 'pipeline',
                entity: 'deals',
                aggregation: 'SUM',
                field: 'amount',
                timeframe: 'ALL',
                groupBy: 'status',
              },
            ],
          }),
      );

      expect(response.status).toBe(201);
      expect(response.body.scope).toBe('TENANT');

      const byId = Object.fromEntries(
        response.body.results.map((widget: any) => [widget.id, widget]),
      );
      expect(byId['all-expenses'].value).toBe(1399);
      expect(byId['recent-expenses'].value).toBe(350);
      expect(byId['bad-field'].error.code).toBe('INVALID_AGGREGATION_FIELD');
      expect(byId['pipeline'].series).toEqual([
        { key: 'LEAD', value: 300 },
        { key: 'WON', value: 300 },
      ]);
    });

    it('applies the DEPARTMENT scope to widget data', async () => {
      const response = await as(
        request(server())
          .post('/workspace/modules/finance/finance-overview/aggregate')
          .send({
            widgets: [
              {
                id: 'finance-expenses',
                entity: 'expenses',
                aggregation: 'SUM',
                field: 'amount',
                timeframe: 'ALL',
              },
            ],
          }),
        ACTOR_HOD,
      );

      expect(response.status).toBe(201);
      expect(response.body.scope).toBe('DEPARTMENT');
      expect(response.body.results[0].value).toBe(400);
    });

    it('caps a batch at 12 widgets', async () => {
      const widgets = Array.from({ length: 13 }, (_, index) => ({
        id: `w-${index}`,
        entity: 'expenses',
        aggregation: 'COUNT',
        timeframe: 'ALL',
      }));

      const response = await as(
        request(server())
          .post('/workspace/modules/finance/finance-overview/aggregate')
          .send({ widgets }),
      );

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('TOO_MANY_WIDGETS');
    });
  });

  describe('module config', () => {
    it('rejects config updates from non-admins', async () => {
      const response = await as(
        request(server())
          .patch('/workspace/modules/finance/contacts/config')
          .send({
            columns: [],
            defaultSort: { field: 'createdAt', dir: 'desc' },
          }),
        ACTOR_STAFF,
      );

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MODULE_FORBIDDEN');
    });

    it('validates and persists an admin config change', async () => {
      const response = await as(
        request(server())
          .patch('/workspace/modules/finance/contacts/config')
          .send({
            version: 1,
            entity: 'contacts',
            columns: [
              { field: 'firstName', label: 'First name', type: 'text' },
            ],
            defaultSort: { field: 'createdAt', dir: 'desc' },
            pageSize: 50,
            searchFields: ['firstName'],
            createEnabled: true,
            filters: [],
          }),
      );

      expect(response.status).toBe(200);
      expect(response.body.config.pageSize).toBe(50);

      const stored = state.modules.find((row) => row.id === MODULE_CONTACTS);
      expect(stored?.config?.pageSize).toBe(50);
      expect(
        state.auditLogs.some((row) => row.action === 'UPDATE_CONFIG'),
      ).toBe(true);
    });

    it('rejects invalid config payloads', async () => {
      const response = await as(
        request(server())
          .patch('/workspace/modules/finance/contacts/config')
          .send({ pageSize: 25 }),
      );

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_MODULE_CONFIG');
    });
  });

  describe('documents', () => {
    it('creates and versions a document', async () => {
      const created = await as(
        request(server())
          .post('/workspace/modules/finance/policies/documents')
          .send({
            title: 'Travel policy',
            content: '# Travel policy\n\nBook early.',
            category: 'Policies',
          }),
      );

      expect(created.status).toBe(201);
      expect(created.body.slug).toMatch(/^travel-policy-/);
      expect(created.body.version).toBe(1);
      expect(created.body.departmentId).toBeNull();

      const updated = await as(
        request(server())
          .patch(
            `/workspace/modules/finance/policies/documents/${created.body.id}`,
          )
          .send({ content: '# Travel policy v2' }),
      );

      expect(updated.status).toBe(200);
      expect(updated.body.version).toBe(2);
      expect(updated.body.content).toBe('# Travel policy v2');
    });

    it('rejects raw HTML in markdown documents', async () => {
      const response = await as(
        request(server())
          .post('/workspace/modules/finance/policies/documents')
          .send({
            title: 'Bad doc',
            content: '<script>alert(1)</script>',
          }),
      );

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_DOCUMENT');
    });

    it('applies department visibility and archives on delete', async () => {
      const created = await as(
        request(server())
          .post('/workspace/modules/finance/policies/documents')
          .send({ title: 'Sales note', content: 'Internal note' }),
        ACTOR_STAFF,
      );

      expect(created.status).toBe(201);
      expect(created.body.departmentId).toBe(DEPT_SALES);

      const list = await as(
        request(server()).get('/workspace/modules/finance/policies/documents'),
        ACTOR_STAFF,
      );
      expect(list.status).toBe(200);
      const ids = list.body.data.map((row: any) => row.id);
      expect(ids).toContain(created.body.id);
      expect(ids).not.toContain(DOC_FINANCE);

      const hardAsStaff = await as(
        request(server()).delete(
          `/workspace/modules/finance/policies/documents/${created.body.id}?hard=true`,
        ),
        ACTOR_STAFF,
      );
      expect(hardAsStaff.status).toBe(403);

      const archived = await as(
        request(server()).delete(
          `/workspace/modules/finance/policies/documents/${created.body.id}`,
        ),
        ACTOR_STAFF,
      );
      expect(archived.status).toBe(200);
      expect(archived.body).toEqual({
        id: created.body.id,
        archived: true,
        deleted: false,
      });

      const stored = state.documents.find((row) => row.id === created.body.id);
      expect(stored?.status).toBe('ARCHIVED');

      const hardAsAdmin = await as(
        request(server()).delete(
          `/workspace/modules/finance/policies/documents/${created.body.id}?hard=true`,
        ),
      );
      expect(hardAsAdmin.status).toBe(200);
      expect(hardAsAdmin.body.deleted).toBe(true);
    });
  });

  describe('form submissions', () => {
    it('validates, mirrors to the entity and audits the submission', async () => {
      const response = await as(
        request(server())
          .post('/workspace/modules/hr/expense-claims/submissions')
          .send({
            data: {
              description: 'Taxi to client',
              amount: 42.5,
              category: 'Travel',
            },
          }),
        ACTOR_STAFF,
      );

      expect(response.status).toBe(201);
      expect(response.body.submissionId).toBeTruthy();
      expect(response.body.entityId).toBeTruthy();

      const expense = state.expenses.find(
        (row) => row.id === response.body.entityId,
      );
      expect(expense?.amount).toBe(42.5);
      expect(expense?.userId).toBe('user-staff');
      expect(expense?.departmentId).toBe(DEPT_SALES);

      expect(
        state.auditLogs.some(
          (row) =>
            row.action === 'CREATE' &&
            row.entity === 'expenses' &&
            row.entityId === response.body.entityId,
        ),
      ).toBe(true);
      expect(
        state.auditLogs.some(
          (row) =>
            row.action === 'SUBMIT' &&
            row.entity === 'form_submissions' &&
            row.entityId === response.body.submissionId,
        ),
      ).toBe(true);

      const list = await as(
        request(server()).get(
          '/workspace/modules/hr/expense-claims/submissions',
        ),
        ACTOR_STAFF,
      );
      expect(list.status).toBe(200);
      expect(list.body.scope).toBe('SELF');
      expect(list.body.meta.total).toBe(1);
    });

    it('enforces required fields and the form allowlist', async () => {
      const missing = await as(
        request(server())
          .post('/workspace/modules/hr/expense-claims/submissions')
          .send({ data: { amount: 10, category: 'Travel' } }),
        ACTOR_STAFF,
      );
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe('INVALID_SUBMISSION');

      const unknown = await as(
        request(server())
          .post('/workspace/modules/hr/expense-claims/submissions')
          .send({
            data: {
              description: 'Taxi',
              amount: 10,
              category: 'Travel',
              smuggled: 'value',
            },
          }),
        ACTOR_STAFF,
      );
      expect(unknown.status).toBe(400);
      expect(unknown.body.message).toContain('not part of this form');
    });
  });
});

// test/workspace/lookup-attachments.e2e-spec.ts
//
// Stage 7: scoped relation lookups and record attachments.
//
// The real controllers and services run against the in-memory Prisma double.
// Storage is the local driver writing to a temporary directory, so the
// presign → upload → register → download → delete loop is exercised end to
// end without network access.

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PermissionType } from '@prisma/client';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as request from 'supertest';

import { CacheService } from '../../src/cache/cache.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PermissionResolutionService } from '../../src/auth/services/permission-resolution.service';
import { LocalStorageDriver } from '../../src/storage/drivers/local-storage.driver';
import { StorageService } from '../../src/storage/storage.service';
import { LookupsController } from '../../src/workspace/controllers/lookups.controller';
import { AttachmentsController } from '../../src/workspace/controllers/attachments.controller';
import { ModulePermissionGuard } from '../../src/workspace/guards/module-permission.guard';
import { LookupService } from '../../src/workspace/lookups/lookup.service';
import { AttachmentService } from '../../src/workspace/services/attachment.service';
import { AuditService } from '../../src/workspace/services/audit.service';
import { EntityQueryService } from '../../src/workspace/services/entity-query.service';
import { EntityRegistryService } from '../../src/workspace/services/entity-registry.service';
import { EntityWriteService } from '../../src/workspace/services/entity-write.service';
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

const DEPT_SALES = 'aaaaaaaa-0000-4000-8000-000000000002';
const DEPT_FINANCE_B = 'bbbbbbbb-0000-4000-8000-000000000001';

const MODULE_DEALS = 'cccccccc-0000-4000-8000-000000000002';
const MODULE_TASKS = 'cccccccc-0000-4000-8000-000000000007';
const MODULE_CONTACTS_B = 'dddddddd-0000-4000-8000-000000000001';

const DEAL_1 = 'ffffffff-0000-4000-8000-000000000001';
const PROJECT_1 = '12121212-0000-4000-8000-000000000001';
const PROJECT_B = '12121212-0000-4000-8000-000000000002';

const ACTOR_ADMIN = {
  id: 'user-admin',
  tenantId: TENANT_A,
  roleId: 'role-admin',
  dataScope: 'TENANT',
  departmentId: DEPT_SALES,
  managedDepartmentId: null,
  isTenantAdmin: true,
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

const PERMISSIONS: Record<string, Record<string, PermissionType[]>> = {
  'role-staff': {
    [MODULE_DEALS]: [
      PermissionType.VIEW,
      PermissionType.CREATE,
      PermissionType.EDIT,
    ],
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
  const financeB = {
    id: DEPT_FINANCE_B,
    tenantId: TENANT_B,
    key: 'finance',
    name: 'Finance',
    sortOrder: 1,
  };

  const state = emptyWorkspaceState();

  state.modules = [
    {
      id: MODULE_DEALS,
      tenantId: TENANT_A,
      key: 'deals',
      name: 'Deals',
      path: '/dept/sales/deals',
      icon: null,
      group: 'Sales',
      order: 1,
      isNavigable: true,
      description: 'Deals module',
      type: 'DATA_TABLE',
      targetEntity: 'deals',
      config: {},
      dataScope: null,
      isActive: true,
      departmentId: DEPT_SALES,
      department: sales,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: MODULE_TASKS,
      tenantId: TENANT_A,
      key: 'tasks',
      name: 'Tasks',
      path: '/dept/sales/tasks',
      icon: null,
      group: 'Sales',
      order: 2,
      isNavigable: true,
      description: 'Tasks module',
      type: 'DATA_TABLE',
      targetEntity: 'tasks',
      config: {},
      dataScope: null,
      isActive: true,
      departmentId: DEPT_SALES,
      department: sales,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: MODULE_CONTACTS_B,
      tenantId: TENANT_B,
      key: 'contacts',
      name: 'Contacts',
      path: '/dept/finance/contacts',
      icon: null,
      group: 'Finance',
      order: 1,
      isNavigable: true,
      description: 'Contacts',
      type: 'DATA_TABLE',
      targetEntity: 'contacts',
      config: {},
      dataScope: null,
      isActive: true,
      departmentId: DEPT_FINANCE_B,
      department: financeB,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  state.departments = [sales, financeB];

  state.users = [
    {
      id: 'user-admin',
      tenantId: TENANT_A,
      name: 'Ada Admin',
      email: 'ada@acme.test',
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
      id: 'user-fired',
      tenantId: TENANT_A,
      name: 'Fired Fred',
      email: 'fred@acme.test',
      status: 'FIRED',
      departmentId: DEPT_SALES,
    },
    {
      id: 'user-b',
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
      firstName: 'Fiona',
      lastName: 'Finance',
      company: 'Acme',
      email: 'fiona@acme.test',
      userId: 'user-staff',
      deletedAt: null,
    },
    {
      id: 'eeeeeeee-0000-4000-8000-000000000002',
      tenantId: TENANT_A,
      firstName: 'Gone',
      lastName: 'Contact',
      company: 'Old Co',
      email: 'gone@acme.test',
      userId: 'user-staff',
      deletedAt: new Date(),
    },
    {
      id: 'eeeeeeee-0000-4000-8000-000000000003',
      tenantId: TENANT_B,
      firstName: 'Bea',
      lastName: 'Beta',
      company: 'Beta Co',
      email: 'bea@beta.test',
      userId: 'user-b',
      deletedAt: null,
    },
  ];

  state.projects = [
    {
      id: PROJECT_1,
      tenantId: TENANT_A,
      name: 'Apollo',
      status: 'ACTIVE',
      deletedAt: null,
    },
    {
      id: PROJECT_B,
      tenantId: TENANT_B,
      name: 'Beta project',
      status: 'ACTIVE',
      deletedAt: null,
    },
  ];

  state.deals = [
    {
      id: DEAL_1,
      tenantId: TENANT_A,
      name: 'Lead one',
      amount: 100,
      status: 'LEAD',
      contactId: 'eeeeeeee-0000-4000-8000-000000000001',
      userId: 'user-staff',
      assignedTo: {
        id: 'user-staff',
        name: 'Sam Staff',
        departmentId: DEPT_SALES,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  return state;
}

describe('Lookups and attachments (Stage 7)', () => {
  let app: INestApplication;
  let state: WorkspaceState;
  let storage: StorageService;
  let storageRoot: string;

  const as = (
    test: request.Test,
    actor: Record<string, unknown> = ACTOR_ADMIN,
  ) => test.set('x-test-user', JSON.stringify(actor));

  beforeEach(async () => {
    state = buildState();
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'clasp-attach-'));

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

    storage = new StorageService(
      new LocalStorageDriver({
        rootDir: storageRoot,
        baseUrl: 'http://localhost:3030',
        secret: 'e2e-storage-secret',
      }),
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [LookupsController, AttachmentsController],
      providers: [
        EntityRegistryService,
        ScopeFilterService,
        ModuleConfigService,
        ModuleAccessService,
        AuditService,
        EntityQueryService,
        EntityWriteService,
        LookupService,
        AttachmentService,
        ModulePermissionGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: PermissionResolutionService, useValue: permissions },
        {
          provide: CacheService,
          useValue: { flushTenant: jest.fn(), invalidatePattern: jest.fn() },
        },
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
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  const server = () => app.getHttpServer();

  describe('GET /lookups/:field', () => {
    it('returns tenant-scoped contact options', async () => {
      const response = await as(
        request(server()).get(
          '/workspace/modules/sales/deals/lookups/contactId',
        ),
      );

      expect(response.status).toBe(200);
      expect(response.body.field).toBe('contactId');
      expect(response.body.options).toEqual([
        {
          value: 'eeeeeeee-0000-4000-8000-000000000001',
          label: 'Fiona Finance',
          secondary: 'Acme',
          meta: { company: 'Acme', email: 'fiona@acme.test' },
        },
      ]);
    });

    it('filters by the search term and excludes deleted rows', async () => {
      const response = await as(
        request(server()).get(
          '/workspace/modules/sales/deals/lookups/contactId?q=gone',
        ),
      );

      expect(response.status).toBe(200);
      expect(response.body.options).toEqual([]);
    });

    it('excludes suspended and fired users', async () => {
      const response = await as(
        request(server()).get(
          '/workspace/modules/sales/deals/lookups/userId?q=fred',
        ),
      );

      expect(response.status).toBe(200);
      expect(response.body.options).toEqual([]);
    });

    it('drops cross-tenant ids', async () => {
      const response = await as(
        request(server()).get(
          '/workspace/modules/sales/deals/lookups/contactId?ids=eeeeeeee-0000-4000-8000-000000000003',
        ),
      );
      expect(response.status).toBe(200);
      expect(response.body.options).toEqual([]);
    });

    it('resolves tenant projects and hides deleted or foreign rows', async () => {
      const response = await as(
        request(server()).get(
          '/workspace/modules/sales/tasks/lookups/projectId',
        ),
      );
      expect(response.status).toBe(200);
      expect(response.body.options).toEqual([
        {
          value: PROJECT_1,
          label: 'Apollo',
          secondary: 'ACTIVE',
          meta: { status: 'ACTIVE' },
        },
      ]);

      const foreign = await as(
        request(server()).get(
          `/workspace/modules/sales/tasks/lookups/projectId?ids=${PROJECT_B}`,
        ),
      );
      expect(foreign.body.options).toEqual([]);
    });

    it('rejects a field that is not a reference', async () => {
      const response = await as(
        request(server()).get('/workspace/modules/sales/deals/lookups/name'),
      );
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('FIELD_NOT_REFERENCE');
    });

    it('denies a module the caller cannot view', async () => {
      const response = await as(
        request(server()).get(
          '/workspace/modules/sales/tasks/lookups/projectId',
        ),
        ACTOR_STAFF,
      );
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MODULE_FORBIDDEN');
    });
  });

  describe('attachments', () => {
    async function uploadObject(
      key: string,
      contentType: string,
      bytes: number[],
    ) {
      const driver = storage.local!;
      const url = await driver.presignUpload({
        key,
        contentType,
        size: bytes.length,
        expiresInSeconds: 300,
      });
      const token = new URL(url).searchParams.get('token') as string;
      const payload = driver.verifyUploadToken(token);
      await driver.writeUpload(
        payload.key,
        payload.contentType,
        payload.size,
        (async function* () {
          yield Buffer.from(bytes);
        })(),
      );
      return key;
    }

    async function presignAndUpload(): Promise<{
      key: string;
      size: number;
    }> {
      const presign = await storage.presignUpload({
        tenantId: TENANT_A,
        userId: ACTOR_ADMIN.id,
        purpose: 'attachment',
        contentType: 'application/pdf',
        size: 4,
      });
      await uploadObject(presign.key, 'application/pdf', [1, 2, 3, 4]);
      return { key: presign.key, size: 4 };
    }

    it('registers, lists and deletes an attachment', async () => {
      const { key, size } = await presignAndUpload();

      const created = await as(
        request(server())
          .post(`/workspace/modules/sales/deals/records/${DEAL_1}/attachments`)
          .send({
            key,
            fileName: 'contract.pdf',
            mimeType: 'application/pdf',
            size,
          }),
      );

      expect(created.status).toBe(201);
      expect(created.body.fileName).toBe('contract.pdf');
      expect(created.body.downloadUrl).toContain('/storage/local?key=');

      const list = await as(
        request(server()).get(
          `/workspace/modules/sales/deals/records/${DEAL_1}/attachments`,
        ),
      );
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toBe(created.body.id);

      const removed = await as(
        request(server()).delete(
          `/workspace/modules/sales/deals/records/${DEAL_1}/attachments/${created.body.id}`,
        ),
      );
      expect(removed.status).toBe(200);
      expect(removed.body).toEqual({ id: created.body.id, deleted: true });

      const after = await as(
        request(server()).get(
          `/workspace/modules/sales/deals/records/${DEAL_1}/attachments`,
        ),
      );
      expect(after.body.data).toEqual([]);

      expect(
        state.auditLogs.some((row) => row.action === 'ATTACHMENT_ADD'),
      ).toBe(true);
    });

    it('rejects a key owned by another user', async () => {
      const presign = await storage.presignUpload({
        tenantId: TENANT_A,
        userId: 'user-staff',
        purpose: 'attachment',
        contentType: 'application/pdf',
        size: 4,
      });
      await uploadObject(presign.key, 'application/pdf', [1, 2, 3, 4]);

      const response = await as(
        request(server())
          .post(`/workspace/modules/sales/deals/records/${DEAL_1}/attachments`)
          .send({
            key: presign.key,
            fileName: 'contract.pdf',
            mimeType: 'application/pdf',
            size: 4,
          }),
      );

      expect(response.status).toBe(400);
    });

    it('rejects a cross-tenant key', async () => {
      const presign = await storage.presignUpload({
        tenantId: TENANT_B,
        userId: ACTOR_ADMIN.id,
        purpose: 'attachment',
        contentType: 'application/pdf',
        size: 4,
      });
      await uploadObject(presign.key, 'application/pdf', [1, 2, 3, 4]);

      const response = await as(
        request(server())
          .post(`/workspace/modules/sales/deals/records/${DEAL_1}/attachments`)
          .send({
            key: presign.key,
            fileName: 'contract.pdf',
            mimeType: 'application/pdf',
            size: 4,
          }),
      );

      expect(response.status).toBe(400);
    });

    it('rejects an unknown record', async () => {
      const response = await as(
        request(server()).get(
          '/workspace/modules/sales/deals/records/00000000-0000-4000-8000-000000000099/attachments',
        ),
      );
      expect(response.status).toBe(404);
    });

    it('only lets the uploader or an admin delete', async () => {
      const { key, size } = await presignAndUpload();

      const created = await as(
        request(server())
          .post(`/workspace/modules/sales/deals/records/${DEAL_1}/attachments`)
          .send({
            key,
            fileName: 'contract.pdf',
            mimeType: 'application/pdf',
            size,
          }),
      );
      expect(created.status).toBe(201);

      const forbidden = await as(
        request(server()).delete(
          `/workspace/modules/sales/deals/records/${DEAL_1}/attachments/${created.body.id}`,
        ),
        ACTOR_STAFF,
      );
      expect(forbidden.status).toBe(403);
      expect(forbidden.body.code).toBe('ATTACHMENT_DELETE_FORBIDDEN');
    });

    it('returns not found when attachments are disabled', async () => {
      const previous = process.env.ATTACHMENTS_ENABLED;
      process.env.ATTACHMENTS_ENABLED = 'false';
      try {
        const response = await as(
          request(server()).get(
            `/workspace/modules/sales/deals/records/${DEAL_1}/attachments`,
          ),
        );
        expect(response.status).toBe(404);
        expect(response.body.code).toBe('ATTACHMENTS_DISABLED');
      } finally {
        if (previous === undefined) delete process.env.ATTACHMENTS_ENABLED;
        else process.env.ATTACHMENTS_ENABLED = previous;
      }
    });
  });
});

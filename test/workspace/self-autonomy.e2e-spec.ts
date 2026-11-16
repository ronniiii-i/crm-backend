// test/workspace/self-autonomy.e2e-spec.ts
//
// Stage 4: self-scope autonomy and reassignment.
//
// The app is built from the real workspace controllers, guard and services;
// only Prisma and the ACL resolver are in-memory doubles. The cases cover:
//   * SELF edit allowlists (own records only, whitelisted fields only)
//   * SELF delete denial
//   * entity-wide self-edit denial (attendance)
//   * reassignment by TENANT / DEPARTMENT / TEAM scope
//   * target eligibility: active, in-scope, and able to view the module
//   * reassignment audit rows and the assignee picker

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PermissionType } from '@prisma/client';
import * as request from 'supertest';

import { PrismaService } from '../../src/prisma/prisma.service';
import { CacheService } from '../../src/cache/cache.service';
import { PermissionResolutionService } from '../../src/auth/services/permission-resolution.service';
import { AggregateController } from '../../src/workspace/controllers/aggregate.controller';
import { CatalogController } from '../../src/workspace/controllers/catalog.controller';
import { DocumentsController } from '../../src/workspace/controllers/documents.controller';
import { RecordsController } from '../../src/workspace/controllers/records.controller';
import { SubmissionsController } from '../../src/workspace/controllers/submissions.controller';
import { WorkspaceController } from '../../src/workspace/workspace.controller';
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

const DEPT_SALES = 'aaaaaaaa-0000-4000-8000-000000000002';
const DEPT_FINANCE = 'aaaaaaaa-0000-4000-8000-000000000001';

const MODULE_TASKS = 'cccccccc-0000-4000-8000-000000000010';
const MODULE_DEALS = 'cccccccc-0000-4000-8000-000000000011';
const MODULE_ATTENDANCE = 'cccccccc-0000-4000-8000-000000000012';
const MODULE_CONTACTS = 'cccccccc-0000-4000-8000-000000000013';

const USER_STAFF = '11111111-0000-4000-8000-000000000101';
const USER_STAFF_2 = '11111111-0000-4000-8000-000000000102';
const USER_LEAD = '11111111-0000-4000-8000-000000000103';
const USER_ADMIN = '11111111-0000-4000-8000-000000000104';
const USER_OUTSIDE = '11111111-0000-4000-8000-000000000105';
const USER_INACTIVE = '11111111-0000-4000-8000-000000000106';
const USER_NO_ACCESS = '11111111-0000-4000-8000-000000000107';
const USER_SELF_DELETE = '11111111-0000-4000-8000-000000000108';

const TASK_OWN = 'eeeeeeee-0000-4000-8000-000000000001';
const TASK_TEAM = 'eeeeeeee-0000-4000-8000-000000000002';
const TASK_OUTSIDE = 'eeeeeeee-0000-4000-8000-000000000003';
const TASK_SELF_DELETE = 'eeeeeeee-0000-4000-8000-000000000008';
const DEAL_OWN = 'eeeeeeee-0000-4000-8000-000000000004';
const ATTENDANCE_OWN = 'eeeeeeee-0000-4000-8000-000000000005';
const CONTACT_OWN = 'eeeeeeee-0000-4000-8000-000000000006';
const PROJECT_ID = 'eeeeeeee-0000-4000-8000-000000000007';

const TEAM_SALES = 'bbbbbbbb-0000-4000-8000-000000000002';

const staffActor = {
  id: USER_STAFF,
  tenantId: TENANT_A,
  roleId: 'role-staff',
  dataScope: 'SELF',
  departmentId: DEPT_SALES,
  managedDepartmentId: null,
  isTenantAdmin: false,
};

const leadActor = {
  id: USER_LEAD,
  tenantId: TENANT_A,
  roleId: 'role-lead',
  dataScope: 'TEAM',
  departmentId: DEPT_SALES,
  managedDepartmentId: null,
  isTenantAdmin: false,
};

const adminActor = {
  id: USER_ADMIN,
  tenantId: TENANT_A,
  roleId: 'role-admin',
  dataScope: 'TENANT',
  departmentId: DEPT_FINANCE,
  managedDepartmentId: null,
  isTenantAdmin: true,
};

const PERMISSIONS: Record<string, Record<string, PermissionType[]>> = {
  'role-admin': {
    [MODULE_TASKS]: [
      PermissionType.VIEW,
      PermissionType.CREATE,
      PermissionType.EDIT,
      PermissionType.DELETE,
    ],
    [MODULE_DEALS]: [
      PermissionType.VIEW,
      PermissionType.CREATE,
      PermissionType.EDIT,
      PermissionType.DELETE,
    ],
    [MODULE_ATTENDANCE]: [
      PermissionType.VIEW,
      PermissionType.CREATE,
      PermissionType.EDIT,
      PermissionType.DELETE,
    ],
    [MODULE_CONTACTS]: [
      PermissionType.VIEW,
      PermissionType.CREATE,
      PermissionType.EDIT,
      PermissionType.DELETE,
    ],
  },
  'role-lead': {
    [MODULE_TASKS]: [
      PermissionType.VIEW,
      PermissionType.CREATE,
      PermissionType.EDIT,
    ],
    [MODULE_DEALS]: [
      PermissionType.VIEW,
      PermissionType.CREATE,
      PermissionType.EDIT,
    ],
  },
  'role-staff': {
    [MODULE_TASKS]: [
      PermissionType.VIEW,
      PermissionType.CREATE,
      PermissionType.EDIT,
    ],
    [MODULE_DEALS]: [
      PermissionType.VIEW,
      PermissionType.CREATE,
      PermissionType.EDIT,
    ],
    [MODULE_ATTENDANCE]: [
      PermissionType.VIEW,
      PermissionType.CREATE,
      PermissionType.EDIT,
    ],
    [MODULE_CONTACTS]: [
      PermissionType.VIEW,
      PermissionType.CREATE,
      PermissionType.EDIT,
    ],
  },
  'role-no-access': {},
  'role-self-delete': {
    [MODULE_TASKS]: [PermissionType.VIEW, PermissionType.DELETE],
  },
};

const selfDeleteActor = {
  ...staffActor,
  id: USER_SELF_DELETE,
  roleId: 'role-self-delete',
};

const DEPARTMENTS = {
  sales: {
    id: DEPT_SALES,
    tenantId: TENANT_A,
    key: 'sales',
    name: 'Sales',
    sortOrder: 2,
  },
  finance: {
    id: DEPT_FINANCE,
    tenantId: TENANT_A,
    key: 'finance',
    name: 'Finance',
    sortOrder: 1,
  },
};

function userRow(
  id: string,
  name: string,
  roleId: string,
  departmentId: string,
  status = 'ACTIVE',
) {
  return {
    id,
    tenantId: TENANT_A,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@acme.test`,
    roleId,
    departmentId,
    status,
    role: {
      id: roleId,
      isTenantAdmin: roleId === 'role-admin',
    },
  };
}

function moduleRow(
  id: string,
  key: string,
  department: { id: string; key: string; name: string },
  targetEntity: string,
) {
  return {
    id,
    tenantId: TENANT_A,
    key,
    name: key,
    path: `/dept/${department.key}/${key}`,
    icon: null,
    group: department.name,
    order: 1,
    isNavigable: true,
    description: `${key} module`,
    type: 'DATA_TABLE',
    targetEntity,
    config: { version: 1, entity: targetEntity },
    dataScope: null,
    isActive: true,
    departmentId: department.id,
    department,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildState(): WorkspaceState {
  const { sales, finance } = DEPARTMENTS;

  return {
    ...emptyWorkspaceState(),
    departments: [sales, finance],
    modules: [
      moduleRow(MODULE_TASKS, 'tasks', sales, 'tasks'),
      moduleRow(MODULE_DEALS, 'deals', sales, 'deals'),
      moduleRow(MODULE_ATTENDANCE, 'attendance', sales, 'attendance_records'),
      moduleRow(MODULE_CONTACTS, 'contacts', sales, 'contacts'),
    ],
    users: [
      userRow(USER_STAFF, 'Sam Staff', 'role-staff', DEPT_SALES),
      userRow(USER_STAFF_2, 'Sara Staff', 'role-staff', DEPT_SALES),
      userRow(USER_LEAD, 'Lee Lead', 'role-lead', DEPT_SALES),
      userRow(USER_ADMIN, 'Ada Admin', 'role-admin', DEPT_FINANCE),
      userRow(USER_OUTSIDE, 'Olivia Outside', 'role-staff', DEPT_FINANCE),
      userRow(
        USER_INACTIVE,
        'Ivan Inactive',
        'role-staff',
        DEPT_SALES,
        'SUSPENDED',
      ),
      userRow(USER_NO_ACCESS, 'Noah NoAccess', 'role-no-access', DEPT_SALES),
      userRow(USER_SELF_DELETE, 'Dana Delete', 'role-self-delete', DEPT_SALES),
    ],
    teams: [
      {
        id: TEAM_SALES,
        tenantId: TENANT_A,
        name: 'Sales pod',
        departmentId: DEPT_SALES,
        leadUserId: USER_LEAD,
        members: [{ userId: USER_STAFF }],
      },
    ],
    teamMembers: [
      {
        id: `${TEAM_SALES}-1`,
        tenantId: TENANT_A,
        teamId: TEAM_SALES,
        userId: USER_STAFF,
      },
      {
        id: `${TEAM_SALES}-2`,
        tenantId: TENANT_A,
        teamId: TEAM_SALES,
        userId: USER_STAFF_2,
      },
      {
        id: `${TEAM_SALES}-3`,
        tenantId: TENANT_A,
        teamId: TEAM_SALES,
        userId: USER_NO_ACCESS,
      },
    ],
    tasks: [
      {
        id: TASK_OWN,
        tenantId: TENANT_A,
        title: 'Own task',
        description: 'Mine',
        status: 'Todo',
        priority: 'Normal',
        assignedToId: USER_STAFF,
        projectId: PROJECT_ID,
        dueDate: null,
        customFields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: TASK_TEAM,
        tenantId: TENANT_A,
        title: 'Team task',
        description: 'Teammate',
        status: 'Todo',
        priority: 'Normal',
        assignedToId: USER_STAFF_2,
        projectId: PROJECT_ID,
        dueDate: null,
        customFields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: TASK_OUTSIDE,
        tenantId: TENANT_A,
        title: 'Outside task',
        description: 'Another department',
        status: 'Todo',
        priority: 'Normal',
        assignedToId: USER_OUTSIDE,
        projectId: PROJECT_ID,
        dueDate: null,
        customFields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: TASK_SELF_DELETE,
        tenantId: TENANT_A,
        title: 'Deletable task',
        description: 'Self delete probe',
        status: 'Todo',
        priority: 'Normal',
        assignedToId: USER_SELF_DELETE,
        projectId: PROJECT_ID,
        dueDate: null,
        customFields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    deals: [
      {
        id: DEAL_OWN,
        tenantId: TENANT_A,
        name: 'Own deal',
        amount: 1000,
        status: 'LEAD',
        userId: USER_STAFF,
        closeDate: null,
        customFields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    attendanceRecords: [
      {
        id: ATTENDANCE_OWN,
        tenantId: TENANT_A,
        userId: USER_STAFF,
        date: new Date(),
        status: 'Present',
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    contacts: [
      {
        id: CONTACT_OWN,
        tenantId: TENANT_A,
        firstName: 'Casey',
        lastName: 'Contact',
        company: 'Acme',
        email: 'casey@acme.test',
        status: 'Lead',
        userId: USER_STAFF,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  };
}

describe('Workspace self autonomy and reassignment (Stage 4)', () => {
  let app: INestApplication;
  let state: WorkspaceState;

  const as = (
    test: request.Test,
    actor: Record<string, unknown> = adminActor,
  ) => test.set('x-test-user', JSON.stringify(actor));

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
  });

  const server = () => app.getHttpServer();

  describe('SELF edit autonomy', () => {
    it('lets a Staff user edit a whitelisted field on their own task', async () => {
      const response = await as(
        request(server())
          .patch(`/workspace/modules/sales/tasks/records/${TASK_OWN}`)
          .send({ status: 'In Progress' }),
        staffActor,
      );

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('In Progress');

      const audit = state.auditLogs.find(
        (row) => row.entityId === TASK_OWN && row.action === 'UPDATE',
      );
      expect(audit).toBeDefined();
      expect(audit!.actorId).toBe(USER_STAFF);
    });

    it('refuses to edit a record that belongs to someone else', async () => {
      const response = await as(
        request(server())
          .patch(`/workspace/modules/sales/tasks/records/${TASK_TEAM}`)
          .send({ status: 'Completed' }),
        staffActor,
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('RECORD_NOT_FOUND');
    });

    it('refuses a field outside the SELF allowlist', async () => {
      const response = await as(
        request(server())
          .patch(`/workspace/modules/sales/tasks/records/${TASK_OWN}`)
          .send({ projectId: PROJECT_ID }),
        staffActor,
      );

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FIELD_FORBIDDEN');
      expect(response.body.field).toBe('projectId');
    });

    it('never allows a SELF-scoped actor to reassign an owned record', async () => {
      const response = await as(
        request(server())
          .post(`/workspace/modules/sales/tasks/records/${TASK_OWN}/reassign`)
          .send({ assignedToId: USER_STAFF_2 }),
        staffActor,
      );

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('REASSIGN_FORBIDDEN');
    });

    it('denies Staff a delete at the module guard', async () => {
      const response = await as(
        request(server()).delete(
          `/workspace/modules/sales/tasks/records/${TASK_OWN}`,
        ),
        staffActor,
      );

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MODULE_FORBIDDEN');
      expect(state.tasks.some((row) => row.id === TASK_OWN)).toBe(true);
    });

    it('refuses a SELF-scoped delete even when the role grants DELETE', async () => {
      const response = await as(
        request(server()).delete(
          `/workspace/modules/sales/tasks/records/${TASK_SELF_DELETE}`,
        ),
        selfDeleteActor,
      );

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('SELF_DELETE_FORBIDDEN');
      expect(state.tasks.some((row) => row.id === TASK_SELF_DELETE)).toBe(true);
    });

    it('refuses SELF edits on entities that deny self-edit entirely', async () => {
      const response = await as(
        request(server())
          .patch(
            `/workspace/modules/sales/attendance/records/${ATTENDANCE_OWN}`,
          )
          .send({ status: 'Absent' }),
        staffActor,
      );

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('SELF_EDIT_FORBIDDEN');
    });
  });

  describe('reassignment', () => {
    it('lets a Team Lead reassign a task inside their team', async () => {
      const response = await as(
        request(server())
          .post(`/workspace/modules/sales/tasks/records/${TASK_TEAM}/reassign`)
          .send({ assignedToId: USER_STAFF }),
        leadActor,
      );

      expect(response.status).toBe(201);
      expect(response.body.assignedToId).toBe(USER_STAFF);
      expect(
        state.tasks.find((row) => row.id === TASK_TEAM)?.assignedToId,
      ).toBe(USER_STAFF);

      const audit = state.auditLogs.find(
        (row) => row.entityId === TASK_TEAM && row.action === 'REASSIGN',
      );
      expect(audit).toBeDefined();
      expect(audit!.actorId).toBe(USER_LEAD);
    });

    it('refuses a target outside the team', async () => {
      const response = await as(
        request(server())
          .post(`/workspace/modules/sales/tasks/records/${TASK_TEAM}/reassign`)
          .send({ assignedToId: USER_OUTSIDE }),
        leadActor,
      );

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('TARGET_OUT_OF_TEAM');
    });

    it('refuses an inactive target', async () => {
      const response = await as(
        request(server())
          .post(`/workspace/modules/sales/tasks/records/${TASK_TEAM}/reassign`)
          .send({ assignedToId: USER_INACTIVE }),
        leadActor,
      );

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('TARGET_UNAVAILABLE');
    });

    it('refuses a target that cannot view the module', async () => {
      const response = await as(
        request(server())
          .post(`/workspace/modules/sales/tasks/records/${TASK_TEAM}/reassign`)
          .send({ assignedToId: USER_NO_ACCESS }),
        leadActor,
      );

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('TARGET_NO_ACCESS');
    });

    it('rejects an invalid assignee id', async () => {
      const response = await as(
        request(server())
          .post(`/workspace/modules/sales/tasks/records/${TASK_TEAM}/reassign`)
          .send({ assignedToId: 'not-a-uuid' }),
        leadActor,
      );

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_ASSIGNEE');
    });

    it('refuses to reassign an entity that is not reassignable', async () => {
      const response = await as(
        request(server())
          .post(
            `/workspace/modules/sales/contacts/records/${CONTACT_OWN}/reassign`,
          )
          .send({ assignedToId: USER_STAFF_2 }),
        staffActor,
      );

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('REASSIGN_UNSUPPORTED');
    });

    it('lets a Tenant Admin reassign across departments', async () => {
      const response = await as(
        request(server())
          .post(`/workspace/modules/sales/tasks/records/${TASK_TEAM}/reassign`)
          .send({ assignedToId: USER_OUTSIDE }),
        adminActor,
      );

      expect(response.status).toBe(201);
      expect(response.body.assignedToId).toBe(USER_OUTSIDE);
    });

    it('lists only in-scope, active users who can view the module', async () => {
      const response = await as(
        request(server()).get(
          '/workspace/modules/sales/tasks/records/assignees',
        ),
        leadActor,
      );

      expect(response.status).toBe(200);
      const ids = response.body.users.map((user: any) => user.id).sort();
      expect(ids).toEqual([USER_LEAD, USER_STAFF, USER_STAFF_2].sort());
    });

    it('denies the assignee list to a role without VIEW', async () => {
      const blocked = {
        ...leadActor,
        roleId: 'role-no-access',
      };
      const response = await as(
        request(server()).get(
          '/workspace/modules/sales/tasks/records/assignees',
        ),
        blocked,
      );

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MODULE_FORBIDDEN');
    });

    it('reassigns a deal through its owner field', async () => {
      const response = await as(
        request(server())
          .post(`/workspace/modules/sales/deals/records/${DEAL_OWN}/reassign`)
          .send({ assignedToId: USER_STAFF_2 }),
        adminActor,
      );

      expect(response.status).toBe(201);
      expect(response.body.userId).toBe(USER_STAFF_2);
    });
  });
});

// test/workspace/leave-workflow.e2e-spec.ts
//
// HTTP-level tests for the Stage 5 leave approval workflow. The Nest
// application is built from the real leave controller, state machine, service,
// notifications service and email renderer; Prisma, the ACL resolver and the
// email transport are in-memory doubles.
//
// Covered: approver resolution (team lead, HOD, HR), the two-stage state
// machine, self-approval and wrong-stage denial, rejection notes, terminal
// conflicts, requester-only cancellation, overlap and backdating rules,
// attendance materialisation, audit timeline, notifications, captured emails
// and the direct-write block on `leave_requests`.

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PermissionType } from '@prisma/client';
import * as request from 'supertest';

import { PermissionResolutionService } from '../../src/auth/services/permission-resolution.service';
import { EMAIL_TRANSPORT } from '../../src/email/email.service';
import { EmailLinkService } from '../../src/email/email-link.service';
import { EmailService } from '../../src/email/email.service';
import {
  NOTIFICATION_BUS,
  LocalNotificationBus,
} from '../../src/notifications/notification.bus';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { LeaveController } from '../../src/workspace/controllers/leave.controller';
import { RecordsController } from '../../src/workspace/controllers/records.controller';
import { ModulePermissionGuard } from '../../src/workspace/guards/module-permission.guard';
import { AuditService } from '../../src/workspace/services/audit.service';
import { EntityQueryService } from '../../src/workspace/services/entity-query.service';
import { EntityRegistryService } from '../../src/workspace/services/entity-registry.service';
import { EntityWriteService } from '../../src/workspace/services/entity-write.service';
import { LeaveWorkflowService } from '../../src/workspace/services/leave-workflow.service';
import { ModuleAccessService } from '../../src/workspace/services/module-access.service';
import { ModuleConfigService } from '../../src/workspace/services/module-config.service';
import { ScopeFilterService } from '../../src/workspace/services/scope-filter.service';
import {
  WorkspaceState,
  createFakeWorkspacePrisma,
  emptyWorkspaceState,
} from '../utils/workspace-prisma';

const TENANT = '11111111-1111-4111-8111-111111111111';

const DEPT_SALES = 'aaaaaaaa-0000-4000-8000-000000000001';
const DEPT_HR = 'aaaaaaaa-0000-4000-8000-000000000002';

const MODULE_LEAVE = 'cccccccc-0000-4000-8000-0000000000aa';

const TEAM_SALES = 'bbbbbbbb-0000-4000-8000-000000000001';

const ACTOR_ADMIN = {
  id: 'user-admin',
  tenantId: TENANT,
  roleId: 'role-admin',
  dataScope: 'TENANT',
  departmentId: DEPT_HR,
  managedDepartmentId: DEPT_HR,
  isTenantAdmin: true,
};

const ACTOR_REQUESTER = {
  id: 'user-req',
  tenantId: TENANT,
  roleId: 'role-staff',
  dataScope: 'SELF',
  departmentId: DEPT_SALES,
  managedDepartmentId: null,
  isTenantAdmin: false,
};

const ACTOR_OTHER = {
  id: 'user-other',
  tenantId: TENANT,
  roleId: 'role-staff',
  dataScope: 'SELF',
  departmentId: DEPT_SALES,
  managedDepartmentId: null,
  isTenantAdmin: false,
};

const ACTOR_LEAD = {
  id: 'user-lead',
  tenantId: TENANT,
  roleId: 'role-team-lead',
  dataScope: 'TEAM',
  departmentId: DEPT_SALES,
  managedDepartmentId: null,
  isTenantAdmin: false,
};

const ACTOR_HOD = {
  id: 'user-hod',
  tenantId: TENANT,
  roleId: 'role-hod',
  dataScope: 'DEPARTMENT',
  departmentId: DEPT_SALES,
  managedDepartmentId: DEPT_SALES,
  isTenantAdmin: false,
};

const ACTOR_HR = {
  id: 'user-hr',
  tenantId: TENANT,
  roleId: 'role-hr',
  dataScope: 'DEPARTMENT',
  departmentId: DEPT_HR,
  managedDepartmentId: DEPT_HR,
  isTenantAdmin: false,
};

const ACTIONS = [
  PermissionType.VIEW,
  PermissionType.CREATE,
  PermissionType.EDIT,
];

const PERMISSIONS: Record<string, Record<string, PermissionType[]>> = {
  'role-staff': { [MODULE_LEAVE]: ACTIONS },
  'role-team-lead': { [MODULE_LEAVE]: ACTIONS },
  'role-hod': { [MODULE_LEAVE]: ACTIONS },
  'role-hr': { [MODULE_LEAVE]: ACTIONS },
};

const MODULE_KEY = 'attendance-leave-management';
const MODULE_BASE = `/workspace/modules/human_resources/${MODULE_KEY}/leave-requests`;
const RECORDS_BASE = `/workspace/modules/human_resources/${MODULE_KEY}/records`;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function userRow(params: {
  id: string;
  name: string;
  email: string;
  departmentId: string;
  roleId: string;
  roleSlug: string;
  isTenantAdmin?: boolean;
}): Record<string, any> {
  return {
    id: params.id,
    tenantId: TENANT,
    name: params.name,
    email: params.email,
    status: 'ACTIVE',
    departmentId: params.departmentId,
    roleId: params.roleId,
    isVerified: true,
    role: {
      id: params.roleId,
      slug: params.roleSlug,
      isTenantAdmin: params.isTenantAdmin ?? false,
    },
    createdAt: daysAgo(30),
    updatedAt: daysAgo(1),
  };
}

function buildState(): WorkspaceState {
  const sales = {
    id: DEPT_SALES,
    tenantId: TENANT,
    key: 'sales',
    name: 'Sales',
    managerId: 'user-hod',
    sortOrder: 1,
  };
  const hr = {
    id: DEPT_HR,
    tenantId: TENANT,
    key: 'human_resources',
    name: 'Human Resources',
    managerId: 'user-hr',
    sortOrder: 2,
  };

  return {
    ...emptyWorkspaceState(),

    tenants: [
      {
        id: TENANT,
        tenantId: TENANT,
        slug: 'acme',
        name: 'Acme Corp',
        status: 'ACTIVE',
      },
    ],

    departments: [sales, hr],

    users: [
      userRow({
        id: 'user-admin',
        name: 'Ada Admin',
        email: 'admin@acme.test',
        departmentId: DEPT_HR,
        roleId: 'role-admin',
        roleSlug: 'tenant_admin',
        isTenantAdmin: true,
      }),
      userRow({
        id: 'user-req',
        name: 'Sam Staff',
        email: 'sam@acme.test',
        departmentId: DEPT_SALES,
        roleId: 'role-staff',
        roleSlug: 'staff',
      }),
      userRow({
        id: 'user-other',
        name: 'Ola Other',
        email: 'ola@acme.test',
        departmentId: DEPT_SALES,
        roleId: 'role-staff',
        roleSlug: 'staff',
      }),
      userRow({
        id: 'user-lead',
        name: 'Lee Lead',
        email: 'lee@acme.test',
        departmentId: DEPT_SALES,
        roleId: 'role-team-lead',
        roleSlug: 'team_lead',
      }),
      userRow({
        id: 'user-hod',
        name: 'Hana Hod',
        email: 'hana@acme.test',
        departmentId: DEPT_SALES,
        roleId: 'role-hod',
        roleSlug: 'department_head',
      }),
      userRow({
        id: 'user-hr',
        name: 'Hugo Hr',
        email: 'hugo@acme.test',
        departmentId: DEPT_HR,
        roleId: 'role-hr',
        roleSlug: 'department_head',
      }),
    ],

    teams: [
      {
        id: TEAM_SALES,
        tenantId: TENANT,
        name: 'Sales pod',
        departmentId: DEPT_SALES,
        leadUserId: 'user-lead',
      },
    ],

    teamMembers: [
      {
        id: 'bbbbbbbb-0000-4000-8000-000000000002',
        tenantId: TENANT,
        teamId: TEAM_SALES,
        userId: 'user-req',
      },
    ],

    notificationPreferences: [
      {
        id: 'dddddddd-0000-4000-8000-000000000001',
        tenantId: TENANT,
        userId: 'user-lead',
        type: 'LEAVE_SUBMITTED',
        inApp: true,
        email: true,
      },
    ],

    modules: [
      {
        id: MODULE_LEAVE,
        tenantId: TENANT,
        key: MODULE_KEY,
        name: 'Attendance & Leave',
        path: '/hr/attendance-leave-management',
        icon: null,
        group: 'Human Resources',
        order: 1,
        isNavigable: true,
        description: 'Request and approve leave',
        type: 'WORKFLOW',
        targetEntity: 'leave_requests',
        config: {
          version: 1,
          entity: 'leave_requests',
          workflow: 'leave-approval',
          stages: [
            { value: 'PENDING_TEAM_LEAD', label: 'Team Lead' },
            { value: 'PENDING_HR', label: 'HR' },
          ],
          requesterFields: ['type', 'startDate', 'endDate', 'reason'],
          allowCreate: true,
          allowCancel: true,
        },
        dataScope: null,
        isActive: true,
        departmentId: DEPT_HR,
        department: hr,
        createdAt: daysAgo(30),
        updatedAt: daysAgo(1),
      },
    ],

    auditLogs: [],
    leaveRequests: [],
    notifications: [],
    attendanceRecords: [],
    contacts: [],
    invoices: [],
    expenses: [],
    inventoryItems: [],
    deals: [],
    supportTickets: [],
    tasks: [],
    documents: [],
    formSubmissions: [],
    projects: [],
  };
}

describe('Leave workflow API (Stage 5)', () => {
  let app: INestApplication;
  let state: WorkspaceState;
  let bus: LocalNotificationBus;
  let transport: {
    sent: Array<Record<string, any>>;
    send: jest.Mock;
  };

  const header = (actor: Record<string, unknown>) => JSON.stringify(actor);

  const as = (
    test: request.Test,
    actor: Record<string, unknown> = ACTOR_REQUESTER,
  ) => test.set('x-test-user', header(actor));

  beforeEach(async () => {
    state = buildState();
    bus = new LocalNotificationBus();
    transport = {
      sent: [],
      send: jest.fn(async (input: Record<string, any>) => {
        transport.sent.push(input);
        return { id: `test-email-${transport.sent.length}` };
      }),
    };

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
      controllers: [LeaveController, RecordsController],
      providers: [
        EntityRegistryService,
        ScopeFilterService,
        ModuleConfigService,
        ModuleAccessService,
        AuditService,
        EntityQueryService,
        EntityWriteService,
        LeaveWorkflowService,
        NotificationsService,
        ModulePermissionGuard,
        EmailService,
        EmailLinkService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionResolutionService, useValue: permissions },
        { provide: NOTIFICATION_BUS, useValue: bus },
        { provide: EMAIL_TRANSPORT, useValue: transport },
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

  const submit = (
    actor: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ) =>
    as(
      request(server())
        .post(MODULE_BASE)
        .send({
          type: 'ANNUAL',
          startDate: '2030-01-07',
          endDate: '2030-01-09',
          reason: 'Family trip',
          ...overrides,
        }),
      actor,
    );

  const transition = (
    actor: Record<string, unknown>,
    id: string,
    body: Record<string, unknown>,
  ) =>
    as(
      request(server()).post(`${MODULE_BASE}/${id}/transition`).send(body),
      actor,
    );

  const stored = (id: string) =>
    state.leaveRequests.find((row) => row.id === id) as Record<string, any>;

  const notificationsFor = (userId: string, type?: string) =>
    state.notifications.filter(
      (row) =>
        row.userId === userId && (type === undefined || row.type === type),
    );

  it('runs the lead → HR path and materialises attendance, email and notifications', async () => {
    const created = await submit(ACTOR_REQUESTER);

    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({
      status: 'PENDING_TEAM_LEAD',
      currentStage: 1,
      days: 3,
      teamLeadId: 'user-lead',
      hodId: 'user-hod',
      hrApproverId: 'user-hr',
    });

    // The team lead is notified in-app and, because they opted in, by email.
    expect(notificationsFor('user-lead', 'LEAVE_SUBMITTED')).toHaveLength(1);
    expect(
      transport.sent.some((email) =>
        String(email.subject).startsWith('Leave request from Sam Staff'),
      ),
    ).toBe(true);

    // HR cannot act before the team lead stage.
    const wrongStage = await transition(ACTOR_HR, id, { action: 'APPROVE' });
    expect(wrongStage.status).toBe(403);
    expect(wrongStage.body.code).toBe('NOT_APPROVER');

    const toHr = await transition(ACTOR_LEAD, id, {
      action: 'APPROVE',
      note: 'Approved by lead',
    });
    expect(toHr.status).toBe(201);
    expect(toHr.body.status).toBe('PENDING_HR');
    expect(notificationsFor('user-hr', 'LEAVE_SUBMITTED')).toHaveLength(1);
    expect(notificationsFor('user-req', 'LEAVE_PROGRESS')).toHaveLength(1);

    const approved = await transition(ACTOR_HR, id, { action: 'APPROVE' });
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('APPROVED');

    // One attendance row per working day.
    const attendance = state.attendanceRecords.filter(
      (row) => row.leaveRequestId === id,
    );
    expect(attendance).toHaveLength(3);
    expect(attendance.every((row) => row.status === 'Leave')).toBe(true);

    expect(notificationsFor('user-req', 'LEAVE_DECIDED')).toHaveLength(1);
    expect(
      transport.sent.some(
        (email) => email.subject === 'Your leave request was approved',
      ),
    ).toBe(true);

    const timeline = await as(
      request(server()).get(`${MODULE_BASE}/${id}/timeline`),
      ACTOR_REQUESTER,
    );
    expect(timeline.status).toBe(200);
    expect(timeline.body.request.status).toBe('APPROVED');
    const actions = timeline.body.timeline.map((entry: Record<string, any>) =>
      String(entry.action),
    );
    expect(actions).toEqual(expect.arrayContaining(['SUBMIT', 'APPROVE']));
    expect(
      actions.filter((action: string) => action === 'APPROVE'),
    ).toHaveLength(2);
  });

  it('falls back to the HOD when the requester has no team lead', async () => {
    const created = await submit(ACTOR_OTHER);

    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({
      status: 'PENDING_TEAM_LEAD',
      teamLeadId: null,
      hodId: 'user-hod',
    });
    expect(notificationsFor('user-hod', 'LEAVE_SUBMITTED')).toHaveLength(1);

    const advanced = await transition(ACTOR_HOD, id, { action: 'APPROVE' });
    expect(advanced.status).toBe(201);
    expect(advanced.body.status).toBe('PENDING_HR');

    const approved = await transition(ACTOR_HR, id, { action: 'APPROVE' });
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('APPROVED');
  });

  it('denies self approval', async () => {
    // The HR manager is also the resolved HR approver for their own request.
    const created = await submit(ACTOR_HR);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'PENDING_HR',
      hrApproverId: 'user-hr',
    });

    const selfApproval = await transition(ACTOR_HR, created.body.id, {
      action: 'APPROVE',
    });
    expect(selfApproval.status).toBe(403);
    expect(selfApproval.body.code).toBe('SELF_APPROVAL');
  });

  it('requires a rejection note and treats decided requests as terminal', async () => {
    const created = await submit(ACTOR_REQUESTER);
    const id = created.body.id as string;

    const noNote = await transition(ACTOR_LEAD, id, { action: 'REJECT' });
    expect(noNote.status).toBe(400);
    expect(noNote.body.code).toBe('NOTE_REQUIRED');

    const rejected = await transition(ACTOR_LEAD, id, {
      action: 'REJECT',
      note: 'Coverage is too thin that week.',
    });
    expect(rejected.status).toBe(201);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.decisionNote).toBe('Coverage is too thin that week.');
    expect(stored(id).status).toBe('REJECTED');

    const again = await transition(ACTOR_HR, id, {
      action: 'APPROVE',
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('LEAVE_TERMINAL');
  });

  it('lets only the requester cancel a request', async () => {
    const created = await submit(ACTOR_REQUESTER);
    const id = created.body.id as string;

    const byLead = await transition(ACTOR_LEAD, id, { action: 'CANCEL' });
    expect(byLead.status).toBe(403);
    expect(byLead.body.code).toBe('LEAVE_CANCEL_FORBIDDEN');

    const byRequester = await transition(ACTOR_REQUESTER, id, {
      action: 'CANCEL',
    });
    expect(byRequester.status).toBe(201);
    expect(byRequester.body.status).toBe('CANCELLED');
    expect(stored(id).status).toBe('CANCELLED');
  });

  it('rejects overlapping and backdated requests', async () => {
    const first = await submit(ACTOR_REQUESTER, {
      startDate: '2030-02-04',
      endDate: '2030-02-06',
    });
    expect(first.status).toBe(201);

    const overlap = await submit(ACTOR_REQUESTER, {
      startDate: '2030-02-05',
      endDate: '2030-02-07',
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('LEAVE_OVERLAP');

    const backdated = await submit(ACTOR_REQUESTER, {
      startDate: '2020-01-06',
      endDate: '2020-01-07',
    });
    expect(backdated.status).toBe(400);
    expect(backdated.body.code).toBe('LEAVE_BACKDATED');

    // Tenant admins may backfill history.
    const adminBackfill = await submit(ACTOR_ADMIN, {
      startDate: '2020-01-06',
      endDate: '2020-01-07',
      reason: 'Recorded retrospectively',
    });
    expect(adminBackfill.status).toBe(201);
  });

  it('blocks direct generic writes to leave requests', async () => {
    const created = await submit(ACTOR_REQUESTER);
    const id = created.body.id as string;

    const response = await as(
      request(server())
        .patch(`${RECORDS_BASE}/${id}`)
        .send({ status: 'APPROVED' }),
      ACTOR_REQUESTER,
    );

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('DIRECT_WRITE_DENIED');
    expect(stored(id).status).toBe('PENDING_TEAM_LEAD');
  });
});

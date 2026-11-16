import { ModuleType, PermissionType } from '@prisma/client';

import { CacheService } from '../cache/cache.service';
import { DepartmentsService } from './departments.service';
import { AuditService } from '../workspace/services/audit.service';
import {
  WorkspaceState,
  createFakeWorkspacePrisma,
  emptyWorkspaceState,
} from '../../test/utils/workspace-prisma';

const TENANT = '11111111-1111-1111-1111-111111111111';
const DEPT_FINANCE = 'aaaaaaaa-0000-4000-8000-000000000001';

const ROLES = [
  { id: 'role-admin', slug: 'tenant_admin' },
  { id: 'role-hod', slug: 'department_head' },
  { id: 'role-lead', slug: 'team_lead' },
  { id: 'role-staff', slug: 'staff' },
  { id: 'role-auditor', slug: 'auditor' },
];

const PERMISSIONS = [
  { id: 1, type: PermissionType.VIEW },
  { id: 2, type: PermissionType.CREATE },
  { id: 3, type: PermissionType.EDIT },
  { id: 4, type: PermissionType.DELETE },
];

function buildState(): WorkspaceState {
  return {
    ...emptyWorkspaceState(),
    departments: [
      {
        id: DEPT_FINANCE,
        tenantId: TENANT,
        key: 'finance',
        name: 'Finance',
        description: null,
        isSystem: false,
      },
    ],
    roles: ROLES.map((role) => ({ ...role, tenantId: TENANT })),
    permissions: PERMISSIONS,
  };
}

describe('DepartmentsService module provisioning', () => {
  let state: WorkspaceState;
  let service: DepartmentsService;
  let cache: {
    invalidatePattern: jest.Mock;
    invalidateTenantAcls: jest.Mock;
  };

  beforeEach(() => {
    state = buildState();
    cache = {
      invalidatePattern: jest.fn(),
      invalidateTenantAcls: jest.fn(),
    };
    service = new DepartmentsService(
      createFakeWorkspacePrisma(state),
      cache as unknown as CacheService,
      new AuditService(),
    );
  });

  it('provisions prefixed modules, grants and audit rows', async () => {
    const result = await service.provisionModules(
      TENANT,
      DEPT_FINANCE,
      ['contacts', 'documents'],
      { actorId: 'user-admin', requestId: 'req-provision' },
    );

    expect(result).toMatchObject({
      success: true,
      departmentId: DEPT_FINANCE,
      skipped: [],
    });
    expect(result.created.map((module) => module.key)).toEqual([
      'finance-contacts',
      'finance-documents',
    ]);

    const contacts = state.modules.find(
      (module) => module.key === 'finance-contacts',
    );
    expect(contacts).toMatchObject({
      tenantId: TENANT,
      departmentId: DEPT_FINANCE,
      name: 'Contacts',
      path: '/dept/finance/finance-contacts',
      type: ModuleType.DATA_TABLE,
      targetEntity: 'contacts',
      group: 'Finance',
      isNavigable: true,
    });

    const documents = state.modules.find(
      (module) => module.key === 'finance-documents',
    );
    expect(documents).toMatchObject({
      type: ModuleType.DOCUMENT_HUB,
      targetEntity: null,
      path: '/dept/finance/finance-documents',
    });

    // tenant_admin + department_head get all four actions, team_lead + staff
    // get three; the unrelated role is not granted anything.
    expect(state.roleModulePermissions).toHaveLength(28);
    expect(
      state.roleModulePermissions.every(
        (row) => row.tenantId === TENANT && row.moduleId,
      ),
    ).toBe(true);
    expect(
      state.roleModulePermissions.some((row) => row.roleId === 'role-auditor'),
    ).toBe(false);

    const audits = state.auditLogs.filter(
      (row) => row.action === 'PROVISION_MODULES',
    );
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      tenantId: TENANT,
      departmentId: DEPT_FINANCE,
      actorId: 'user-admin',
      entity: 'modules',
      moduleKey: 'finance-contacts',
      requestId: 'req-provision',
      after: { template: 'contacts', key: 'finance-contacts' },
    });

    expect(cache.invalidatePattern).toHaveBeenCalledWith(
      `tenant:${TENANT}:departments:overview:*`,
    );
    expect(cache.invalidateTenantAcls).toHaveBeenCalledWith(TENANT);
  });

  it('is idempotent for already provisioned modules', async () => {
    await service.provisionModules(TENANT, DEPT_FINANCE, ['contacts']);
    const moduleCount = state.modules.length;
    const grantCount = state.roleModulePermissions.length;
    const auditCount = state.auditLogs.length;

    const second = await service.provisionModules(TENANT, DEPT_FINANCE, [
      'contacts',
    ]);

    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(['contacts']);
    expect(state.modules).toHaveLength(moduleCount);
    expect(state.roleModulePermissions).toHaveLength(grantCount);
    expect(state.auditLogs).toHaveLength(auditCount);
  });

  it('continues module ordering after existing modules', async () => {
    state.modules.push({
      id: 'module-existing',
      tenantId: TENANT,
      departmentId: DEPT_FINANCE,
      key: 'finance-existing',
      path: '/dept/finance/finance-existing',
      name: 'Existing',
      order: 7,
    });

    await service.provisionModules(TENANT, DEPT_FINANCE, ['tasks']);

    expect(
      state.modules.find((module) => module.key === 'finance-tasks')?.order,
    ).toBe(8);
  });

  it('rejects unknown names, non-array values and empty selections', async () => {
    await expect(
      service.provisionModules(TENANT, DEPT_FINANCE, ['nope']),
    ).rejects.toMatchObject({ response: { code: 'UNKNOWN_MODULE_TEMPLATE' } });

    await expect(
      service.provisionModules(TENANT, DEPT_FINANCE, 'contacts'),
    ).rejects.toMatchObject({ response: { code: 'INVALID_MODULE_TEMPLATES' } });

    await expect(
      service.provisionModules(TENANT, DEPT_FINANCE, []),
    ).rejects.toMatchObject({ response: { code: 'INVALID_MODULE_TEMPLATES' } });

    expect(state.modules).toHaveLength(0);
  });

  it('rejects unknown departments and malformed ids', async () => {
    await expect(
      service.provisionModules(TENANT, 'aaaaaaaa-0000-4000-8000-000000000099', [
        'contacts',
      ]),
    ).rejects.toBeInstanceOf(Error);

    await expect(
      service.provisionModules(TENANT, 'not-a-uuid', ['contacts']),
    ).rejects.toMatchObject({ response: { statusCode: 404 } });
  });
});

// test/acl/permission-resolution.e2e-spec.ts
//
// Repaired from the previously commented-out suite. The old file imported
// `src/auth/access-control.guard` and `PROTECTED_ROUTES`; both were replaced
// during the multi-tenant work by `src/auth/guards/access-control.guard` and
// the hybrid ACL resolver in `src/auth/services/permission-resolution.service`.
//
// Covered here:
//   * base role tier
//   * custom permission groups (user assignment + department assignment)
//   * per-user overrides (grant-only, revoke-only, revoke-beats-grant)
//   * the "Role+" contract (a user whose access is enhanced beyond their
//     base role must be reported as augmented)

import { PermissionType, PermissionEffect } from '@prisma/client';
import { PermissionResolutionService } from '../../src/auth/services/permission-resolution.service';
import {
  CacheService,
  InMemoryRedisClient,
} from '../../src/cache/cache.service';
import {
  createFakePrisma,
  rolePermissionRow,
  overrideRow,
} from '../utils/fake-prisma';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const MODULE_FINANCE = 'module-finance';
const MODULE_IT = 'module-it';
const MODULE_SALES = 'module-sales';

describe('PermissionResolutionService (hybrid ACL)', () => {
  let cache: CacheService;
  let service: PermissionResolutionService;

  const baseUser = {
    id: 'user-1',
    role: 'STAFF' as any,
    tenantId: TENANT_A,
    departmentId: 'dept-finance',
    managedDepartmentId: undefined,
  };

  beforeEach(async () => {
    cache = new CacheService(() => new InMemoryRedisClient());
    await cache.onModuleInit();
  });

  afterEach(async () => {
    await cache.onModuleDestroy();
  });

  const build = (state: Parameters<typeof createFakePrisma>[0]) => {
    const prisma = createFakePrisma(state);
    service = new PermissionResolutionService(prisma, cache);
    return prisma;
  };

  describe('base role tier', () => {
    it('grants the permissions attached to the user role', async () => {
      build({
        roleModulePermissions: [
          rolePermissionRow({
            tenantId: TENANT_A,
            role: 'STAFF',
            moduleId: MODULE_FINANCE,
            permissionType: PermissionType.VIEW,
          }),
        ],
      });

      const details = await service.getEffectivePermissionDetails(baseUser);
      const entry = details.get(`${MODULE_FINANCE}:${PermissionType.VIEW}`);

      expect(entry?.granted).toBe(true);
      expect(entry?.sources.map((s) => s.type)).toContain('ROLE');
    });

    it('denies a permission the role does not carry', async () => {
      build({
        roleModulePermissions: [
          rolePermissionRow({
            tenantId: TENANT_A,
            role: 'STAFF',
            moduleId: MODULE_FINANCE,
            permissionType: PermissionType.VIEW,
          }),
        ],
      });

      const details = await service.getEffectivePermissionDetails(baseUser);
      expect(
        details.get(`${MODULE_FINANCE}:${PermissionType.DELETE}`)?.granted ??
          false,
      ).toBe(false);
    });
  });

  describe('custom permission groups', () => {
    it('unions group permissions into the effective set', async () => {
      build({
        roleModulePermissions: [],
        permissionGroupAssignments: [
          {
            id: 'pga-1',
            tenantId: TENANT_A,
            userId: baseUser.id,
            group: {
              id: 'group-finance',
              name: 'Finance Power Users',
              items: [
                {
                  id: 'pgi-1',
                  moduleId: MODULE_FINANCE,
                  permission: { type: PermissionType.EDIT },
                },
              ],
            },
          },
        ],
      });

      const details = await service.getEffectivePermissionDetails(baseUser);
      const entry = details.get(`${MODULE_FINANCE}:${PermissionType.EDIT}`);

      expect(entry?.granted).toBe(true);
      expect(entry?.sources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'GROUP',
            groupName: 'Finance Power Users',
          }),
        ]),
      );
    });

    it('applies groups assigned to the user department', async () => {
      build({
        permissionGroupAssignments: [
          {
            id: 'pga-2',
            tenantId: TENANT_A,
            departmentId: 'dept-finance',
            group: {
              id: 'group-it',
              name: 'IT Dept Group',
              items: [
                {
                  id: 'pgi-2',
                  moduleId: MODULE_IT,
                  permission: { type: PermissionType.VIEW },
                },
              ],
            },
          },
        ],
      });

      const details = await service.getEffectivePermissionDetails(baseUser);
      expect(details.get(`${MODULE_IT}:${PermissionType.VIEW}`)?.granted).toBe(
        true,
      );
    });

    it('ignores groups assigned to another department', async () => {
      build({
        permissionGroupAssignments: [
          {
            id: 'pga-3',
            tenantId: TENANT_A,
            departmentId: 'dept-other',
            group: {
              id: 'group-other',
              name: 'Other Dept Group',
              items: [
                {
                  id: 'pgi-3',
                  moduleId: MODULE_IT,
                  permission: { type: PermissionType.VIEW },
                },
              ],
            },
          },
        ],
      });

      const details = await service.getEffectivePermissionDetails(baseUser);
      expect(
        details.get(`${MODULE_IT}:${PermissionType.VIEW}`)?.granted ?? false,
      ).toBe(false);
    });
  });

  describe('per-user overrides', () => {
    it('grants a permission the base role lacks (grant-only override)', async () => {
      build({
        roleModulePermissions: [],
        permissionOverrides: [
          overrideRow({
            tenantId: TENANT_A,
            userId: baseUser.id,
            moduleId: MODULE_SALES,
            permissionType: PermissionType.DELETE,
            effect: PermissionEffect.GRANT,
          }),
        ],
      });

      const details = await service.getEffectivePermissionDetails(baseUser);
      expect(
        details.get(`${MODULE_SALES}:${PermissionType.DELETE}`)?.granted,
      ).toBe(true);
    });

    it('revokes a permission the base role grants (revoke-only override)', async () => {
      build({
        roleModulePermissions: [
          rolePermissionRow({
            tenantId: TENANT_A,
            role: 'STAFF',
            moduleId: MODULE_FINANCE,
            permissionType: PermissionType.VIEW,
          }),
        ],
        permissionOverrides: [
          overrideRow({
            tenantId: TENANT_A,
            userId: baseUser.id,
            moduleId: MODULE_FINANCE,
            permissionType: PermissionType.VIEW,
            effect: PermissionEffect.REVOKE,
          }),
        ],
      });

      const details = await service.getEffectivePermissionDetails(baseUser);
      expect(
        details.get(`${MODULE_FINANCE}:${PermissionType.VIEW}`)?.granted,
      ).toBe(false);
    });

    it('lets REVOKE beat GRANT on the same module + permission', async () => {
      build({
        permissionOverrides: [
          overrideRow({
            tenantId: TENANT_A,
            userId: baseUser.id,
            moduleId: MODULE_SALES,
            permissionType: PermissionType.EDIT,
            effect: PermissionEffect.GRANT,
            id: 'po-grant',
          }),
          overrideRow({
            tenantId: TENANT_A,
            userId: baseUser.id,
            moduleId: MODULE_SALES,
            permissionType: PermissionType.EDIT,
            effect: PermissionEffect.REVOKE,
            id: 'po-revoke',
          }),
        ],
      });

      const details = await service.getEffectivePermissionDetails(baseUser);
      expect(
        details.get(`${MODULE_SALES}:${PermissionType.EDIT}`)?.granted,
      ).toBe(false);
    });

    it('lets a GRANT beat the base role', async () => {
      build({
        roleModulePermissions: [
          rolePermissionRow({
            tenantId: TENANT_A,
            role: 'STAFF',
            moduleId: MODULE_FINANCE,
            permissionType: PermissionType.VIEW,
          }),
        ],
        permissionOverrides: [
          overrideRow({
            tenantId: TENANT_A,
            userId: baseUser.id,
            moduleId: MODULE_FINANCE,
            permissionType: PermissionType.VIEW,
            effect: PermissionEffect.GRANT,
          }),
        ],
      });

      const details = await service.getEffectivePermissionDetails(baseUser);
      expect(
        details.get(`${MODULE_FINANCE}:${PermissionType.VIEW}`)?.granted,
      ).toBe(true);
    });
  });

  describe('"Role+" contract', () => {
    it('reports a plain role user as NOT augmented', async () => {
      build({
        roleModulePermissions: [
          rolePermissionRow({
            tenantId: TENANT_A,
            role: 'STAFF',
            moduleId: MODULE_FINANCE,
            permissionType: PermissionType.VIEW,
          }),
        ],
      });

      await expect(service.hasEnhancedPermissions(baseUser)).resolves.toBe(
        false,
      );
    });

    it('reports a user with a group assignment as augmented', async () => {
      build({
        permissionGroupAssignments: [
          {
            id: 'pga-4',
            tenantId: TENANT_A,
            userId: baseUser.id,
            group: {
              id: 'group-1',
              name: 'Auditors',
              items: [
                {
                  id: 'pgi-4',
                  moduleId: MODULE_IT,
                  permission: { type: PermissionType.VIEW },
                },
              ],
            },
          },
        ],
      });

      await expect(service.hasEnhancedPermissions(baseUser)).resolves.toBe(
        true,
      );
    });

    it('reports a user with an override as augmented', async () => {
      build({
        permissionOverrides: [
          overrideRow({
            tenantId: TENANT_A,
            userId: baseUser.id,
            moduleId: MODULE_IT,
            permissionType: PermissionType.VIEW,
            effect: PermissionEffect.GRANT,
          }),
        ],
      });

      await expect(service.hasEnhancedPermissions(baseUser)).resolves.toBe(
        true,
      );
    });
  });

  describe('tenant isolation', () => {
    it('never resolves permissions from another tenant', async () => {
      build({
        roleModulePermissions: [
          rolePermissionRow({
            tenantId: TENANT_B,
            role: 'STAFF',
            moduleId: MODULE_FINANCE,
            permissionType: PermissionType.VIEW,
          }),
        ],
      });

      const details = await service.getEffectivePermissionDetails(baseUser);
      expect(
        details.get(`${MODULE_FINANCE}:${PermissionType.VIEW}`)?.granted ??
          false,
      ).toBe(false);
    });

    it('resolves permissions inside the owning tenant', async () => {
      build({
        roleModulePermissions: [
          rolePermissionRow({
            tenantId: TENANT_A,
            role: 'STAFF',
            moduleId: MODULE_FINANCE,
            permissionType: PermissionType.VIEW,
          }),
        ],
      });

      const details = await service.getEffectivePermissionDetails(baseUser);
      expect(
        details.get(`${MODULE_FINANCE}:${PermissionType.VIEW}`)?.granted,
      ).toBe(true);
    });
  });

  describe('caching', () => {
    it('caches the resolved set under a tenant-scoped key', async () => {
      const prisma = build({
        roleModulePermissions: [
          rolePermissionRow({
            tenantId: TENANT_A,
            role: 'STAFF',
            moduleId: MODULE_FINANCE,
            permissionType: PermissionType.VIEW,
          }),
        ],
      });

      await service.getEffectivePermissionDetails(baseUser);
      await service.getEffectivePermissionDetails(baseUser);

      expect(prisma.withTenant).toHaveBeenCalledTimes(1);
    });

    it('keeps tenants isolated in the cache', async () => {
      build({
        roleModulePermissions: [
          rolePermissionRow({
            tenantId: TENANT_A,
            role: 'STAFF',
            moduleId: MODULE_FINANCE,
            permissionType: PermissionType.VIEW,
          }),
        ],
      });

      const tenantBUser = {
        ...baseUser,
        id: 'user-2',
        tenantId: TENANT_B,
      };

      const detailsA = await service.getEffectivePermissionDetails(baseUser);
      const detailsB = await service.getEffectivePermissionDetails(tenantBUser);

      expect(
        detailsA.get(`${MODULE_FINANCE}:${PermissionType.VIEW}`)?.granted,
      ).toBe(true);
      expect(
        detailsB.get(`${MODULE_FINANCE}:${PermissionType.VIEW}`)?.granted ??
          false,
      ).toBe(false);
    });
  });
});

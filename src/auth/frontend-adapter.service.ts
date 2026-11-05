import { Injectable } from '@nestjs/common';
import { PermissionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { AccessibleModule, Permission, UserForAcl } from './permission-types';
import { PermissionResolutionService } from './services/permission-resolution.service';

/** Canonical action order used by the navigation/sidebar payload. */
const ACTION_ORDER: Permission[] = [
  Permission.VIEW,
  Permission.CREATE,
  Permission.EDIT,
  Permission.DELETE,
];

/** Navigation payloads are invalidated on ACL changes, but keep a bound. */
const MODULES_TTL_SECONDS = 15 * 60;

/**
 * Deterministic navigation order:
 *   1. department (global modules first, then by department sortOrder/name)
 *   2. module order
 *   3. module name, then key as a stable tie-breaker
 */
function compareModules(a: AccessibleModule, b: AccessibleModule): number {
  const aDept = a.department ?? null;
  const bDept = b.department ?? null;

  if (!aDept && bDept) return -1;
  if (aDept && !bDept) return 1;

  if (aDept && bDept) {
    if (aDept.sortOrder !== bDept.sortOrder) {
      return aDept.sortOrder - bDept.sortOrder;
    }

    const departmentName = aDept.name.localeCompare(bDept.name);
    if (departmentName !== 0) return departmentName;
  }

  if (a.order !== b.order) return a.order - b.order;

  const name = a.name.localeCompare(b.name);
  if (name !== 0) return name;

  return a.key.localeCompare(b.key);
}

@Injectable()
export class FrontendAdapterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly permissions: PermissionResolutionService,
  ) {}

  private getUserCacheKey(userId: string, tenantId?: string): string {
    return this.cache.tenantKey(`user:${userId}:modules:v2`, tenantId);
  }

  /**
   * Modules the user can view, derived from their effective permissions
   * (role base + groups + overrides) and restricted to their department
   * unless they are a tenant admin or have TENANT data scope.
   *
   * The payload drives the tenant sidebar: it carries the renderer type,
   * department grouping, navigation flags and the caller's effective actions
   * so the client never has to guess what it may render.
   */
  async getAccessibleModules(user: UserForAcl): Promise<AccessibleModule[]> {
    const cacheKey = this.getUserCacheKey(user.id, user.tenantId ?? undefined);
    const cached = await this.cache.get<AccessibleModule[]>(cacheKey);
    if (cached) return cached;

    const effective = await this.permissions.getEffectivePermissions(user);

    const moduleIds = Array.from(effective.entries())
      .filter(([, permissions]) => permissions.has(PermissionType.VIEW))
      .map(([moduleId]) => moduleId);

    if (moduleIds.length === 0) {
      await this.cache.set(cacheKey, [], MODULES_TTL_SECONDS);
      return [];
    }

    const baseFilter = { id: { in: moduleIds } };

    // Tenant admins and TENANT-scoped roles see all matching modules.
    // Everyone else sees only global modules (departmentId = null) plus
    // modules belonging to their own department/managed department.
    const isTenantAdmin = (user as any).isTenantAdmin === true;
    const dataScope = (user as any).dataScope as string | undefined;
    const isUnrestricted = isTenantAdmin || dataScope === 'TENANT';

    const departmentIds = [
      (user as any).departmentId,
      (user as any).managedDepartmentId,
    ].filter((id): id is string => !!id);

    const where = isUnrestricted
      ? baseFilter
      : {
          AND: [
            baseFilter,
            {
              OR: [
                { departmentId: null },
                ...(departmentIds.length
                  ? [{ departmentId: { in: departmentIds } }]
                  : []),
              ],
            },
          ],
        };

    const select = {
      id: true,
      key: true,
      name: true,
      path: true,
      icon: true,
      group: true,
      order: true,
      type: true,
      targetEntity: true,
      isNavigable: true,
      department: {
        select: { id: true, key: true, name: true, sortOrder: true },
      },
    } as const;

    const tenantId = user.tenantId ?? undefined;
    const rows = tenantId
      ? await this.prisma.withTenant(tenantId, (tx) =>
          tx.module.findMany({ where, select }),
        )
      : await this.prisma.module.findMany({ where, select });

    const accessibleModules: AccessibleModule[] = rows
      .map((row) => {
        const granted = effective.get(row.id) ?? new Set<PermissionType>();
        const actions = ACTION_ORDER.filter((action) =>
          granted.has(action as unknown as PermissionType),
        );

        return {
          id: row.id,
          key: row.key,
          name: row.name,
          path: row.path,
          icon: row.icon,
          group: row.group,
          order: row.order,
          type: row.type,
          targetEntity: row.targetEntity,
          isNavigable: row.isNavigable,
          department: row.department
            ? {
                id: row.department.id,
                key: row.department.key,
                name: row.department.name,
                sortOrder: row.department.sortOrder,
              }
            : null,
          actions,
        };
      })
      .sort(compareModules);

    await this.cache.set(cacheKey, accessibleModules, MODULES_TTL_SECONDS);
    return accessibleModules;
  }

  async clearUserCache(userId: string, tenantId?: string): Promise<void> {
    await this.cache.invalidateUser(userId, tenantId);
  }
}

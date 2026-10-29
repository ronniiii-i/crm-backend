import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { AccessibleModule, UserForAcl } from './permission-types';
import { PermissionResolutionService } from './services/permission-resolution.service';

@Injectable()
export class FrontendAdapterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly permissions: PermissionResolutionService,
  ) {}

  private getUserCacheKey(userId: string): string {
    return this.cache.tenantKey(`user:${userId}:modules`);
  }

  /**
   * Modules the user can view, derived from their effective permissions
   * (role base + groups + overrides) and restricted to their department
   * unless they are a tenant admin or have TENANT data scope.
   */
  async getAccessibleModules(user: UserForAcl): Promise<AccessibleModule[]> {
    const cacheKey = this.getUserCacheKey(user.id);
    const cached = await this.cache.get<AccessibleModule[]>(cacheKey);
    if (cached) return cached;

    const effective = await this.permissions.getEffectivePermissions(user);

    const moduleIds = Array.from(effective.entries())
      .filter(([, permissions]) => permissions.has('VIEW'))
      .map(([moduleId]) => moduleId);

    if (moduleIds.length === 0) {
      await this.cache.set(cacheKey, [], 3600);
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
      name: true,
      path: true,
      icon: true,
    } as const;

    const tenantId = user.tenantId ?? undefined;
    const accessibleModules = tenantId
      ? await this.prisma.withTenant(tenantId, (tx) =>
          tx.module.findMany({ where, select }),
        )
      : await this.prisma.module.findMany({ where, select });

    await this.cache.set(cacheKey, accessibleModules, 3600);
    return accessibleModules;
  }

  async clearUserCache(userId: string, tenantId?: string): Promise<void> {
    await this.cache.invalidateUser(userId, tenantId);
  }
}

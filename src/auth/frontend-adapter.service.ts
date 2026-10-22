import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { DepartmentType } from '@prisma/client';
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
   * unless they are an admin.
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

    const where =
      user.role === 'ADMIN'
        ? baseFilter
        : {
            AND: [
              baseFilter,
              {
                OR: [
                  { departmentId: null },
                  ...(this.getDepartmentType(user)
                    ? [{ department: { type: this.getDepartmentType(user) } }]
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

  private getDepartmentType(user: UserForAcl): DepartmentType | undefined {
    const rawType =
      user.role === 'HOD'
        ? user.managedDepartment?.type
        : user.department?.type;

    return rawType as DepartmentType | undefined;
  }

  async clearUserCache(userId: string, tenantId?: string): Promise<void> {
    await this.cache.invalidateUser(userId, tenantId);
  }
}

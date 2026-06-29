import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { DepartmentType } from '@prisma/client';
import { AccessibleModule, UserForAcl } from './permission-types';

@Injectable()
export class FrontendAdapterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private getUserCacheKey(userId: string): string {
    return `user:${userId}:modules`;
  }

  async getAccessibleModules(user: UserForAcl): Promise<AccessibleModule[]> {
    const cacheKey = this.getUserCacheKey(user.id);
    const cached = this.cache.get(cacheKey) as AccessibleModule[] | undefined;
    if (cached) return cached;

    const permissionFilter = {
      roleModulePermissions: {
        some: {
          AND: [{ role: user.role }, { permission: { type: 'VIEW' } }],
        },
      },
    };

    let whereClause: object;

    if (user.role === 'ADMIN') {
      whereClause = permissionFilter;
    } else {
      const rawType =
        user.role === 'HOD'
          ? user.managedDepartment?.type
          : user.department?.type;

      const deptType = rawType as DepartmentType | undefined;

      whereClause = {
        AND: [
          permissionFilter,
          {
            OR: [
              { departmentId: null },
              ...(deptType ? [{ department: { type: deptType } }] : []),
            ],
          },
        ],
      };
    }

    const accessibleModules = await this.prisma.module.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        path: true,
        icon: true,
      },
    });

    this.cache.set(cacheKey, accessibleModules, 3600);
    return accessibleModules;
  }

  clearUserCache(userId: string): void {
    this.cache.del(this.getUserCacheKey(userId));
  }
}

// // src/auth/frontend-adapter.service.ts
// import { Injectable } from '@nestjs/common';
// import { RouteRegistry } from './route-registry';
// import { CacheService } from '../cache/cache.service';
// import {
//   //   Department,
//   //   Permission,
//   ProtectedRoute,
//   UserWithDepartments,
// } from './permission-types';

// @Injectable()
// export class FrontendAdapterService {
//   constructor(
//     private readonly routeRegistry: RouteRegistry,
//     private readonly cache: CacheService,
//   ) {}

//   private getUserCacheKey(userId: string): string {
//     return `user:${userId}:modules`;
//   }

//   async getAccessibleModules(
//     user: UserWithDepartments,
//   ): Promise<ProtectedRoute[]> {
//     const cacheKey = this.getUserCacheKey(user.id);
//     const cached = (await this.cache.get(cacheKey)) as ProtectedRoute[] | null;
//     if (cached) return cached;

//     const modules = this.routeRegistry.ALL_ROUTES.filter((module) => {
//       if (user.role === 'ADMIN') return true;

//       if (module.department) {
//         if (Array.isArray(module.department)) {
//           if (
//             !user.department?.name ||
//             !module.department.includes(user.department.name)
//           ) {
//             return false;
//           }
//         } else {
//           if (
//             !user.department?.name ||
//             module.department !== user.department.name
//           ) {
//             return false;
//           }
//         }
//       }

//       return module.permissions[user.role]?.length > 0;
//     });

//     this.cache.set(cacheKey, modules, 3600);
//     return modules;
//   }

//   clearUserCache(userId: string): void {
//     this.cache.del(this.getUserCacheKey(userId));
//   }
// }


// src/auth/frontend-adapter.service.ts (Modified)
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service'; // Assuming you have a Prisma service
import { CacheService } from '../cache/cache.service';

@Injectable()
export class FrontendAdapterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private getUserCacheKey(userId: string): string {
    return `user:${userId}:modules`;
  }

  async getAccessibleModules(user: any): Promise<any[]> {
    const cacheKey = this.getUserCacheKey(user.id);
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    // Database query replaces the static array logic
    const accessibleModules = await this.prisma.module.findMany({
      where: {
        // Find modules with a specific permission for the user's role
        roleModulePermissions: {
          some: {
            AND: [
              { role: user.role },
              { permission: { type: 'VIEW' } }
            ]
          }
        },
        // Filter by department (optional for CRM-wide modules)
        department: {
          OR: [
            { type: user.department?.name }, // User's department
            { type: null } // CRM-wide modules (no department)
          ]
        }
      },
      select: {
        id: true,
        name: true,
        path: true,
        // Assuming the icon is also stored in the database
        icon: true, // You'll need to add this to your Module model
      },
    });

    // Cache the results
    this.cache.set(cacheKey, accessibleModules, 3600);
    return accessibleModules;
  }
}
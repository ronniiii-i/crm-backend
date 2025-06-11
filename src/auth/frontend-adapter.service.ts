// src/auth/frontend-adapter.service.ts
import { Injectable } from '@nestjs/common';
import { RouteRegistry } from './route-registry';
import { CacheService } from '../cache/cache.service';
import {
  //   Department,
  //   Permission,
  ProtectedRoute,
  UserWithDepartments,
} from './permission-types';

@Injectable()
export class FrontendAdapterService {
  constructor(
    private readonly routeRegistry: RouteRegistry,
    private readonly cache: CacheService,
  ) {}

  private getUserCacheKey(userId: string): string {
    return `user:${userId}:modules`;
  }

  async getAccessibleModules(
    user: UserWithDepartments,
  ): Promise<ProtectedRoute[]> {
    const cacheKey = this.getUserCacheKey(user.id);
    const cached = (await this.cache.get(cacheKey)) as ProtectedRoute[] | null;
    if (cached) return cached;

    const modules = this.routeRegistry.ALL_ROUTES.filter((module) => {
      if (user.role === 'ADMIN') return true;
      if (module.department && module.department !== user.department?.name)
        return false;
      return module.permissions[user.role]?.length > 0;
    });

    this.cache.set(cacheKey, modules, 3600);
    return modules;
  }

  clearUserCache(userId: string): void {
    this.cache.del(this.getUserCacheKey(userId));
  }
}

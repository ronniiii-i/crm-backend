// src/auth/department.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RouteRegistry } from '../route-registry';
import { Department } from '../permission-types';

@Injectable()
export class DepartmentGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private routeRegistry: RouteRegistry,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user: {
        role: string;
        department?: { name: Department };
        managedDepartment?: { name: Department };
      };
      route?: { path?: string };
      url: string;
    }>();
    const user = request.user as {
      role: string;
      department?: { name: Department };
      managedDepartment?: { name: Department };
    };
    const path = request.route?.path || request.url.split('?')[0];

    const route = await this.routeRegistry.findRoute(path);
    if (!route?.department) return true;

    return (
      user.role === 'ADMIN' ||
      user.department?.name === route.department ||
      user.managedDepartment?.name === route.department
    );
  }
}

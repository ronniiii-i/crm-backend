// src/auth/department.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PROTECTED_ROUTES } from './route-registry';

@Injectable()
export class DepartmentGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user: {
        role: string;
        department?: { name: string };
        managedDepartment?: { name: string };
      };
      route?: { path: string };
    }>();
    const routePath = this.getRoutePath({
      route: request.route,
      url:
        'url' in request && typeof request.url === 'string' ? request.url : '',
    });
    const { user } = request;

    const routeConfig = PROTECTED_ROUTES.find(
      (r) => r.path === routePath || this.matchRoutePattern(r.path, routePath),
    );

    if (!routeConfig?.department) return true;

    return (
      user.role === 'ADMIN' ||
      user.department?.name === routeConfig.department ||
      user.managedDepartment?.name === routeConfig.department
    );
  }

  private getRoutePath(request: {
    route?: { path: string };
    url: string;
  }): string {
    return request.route?.path ?? request.url.split('?')[0];
  }

  private matchRoutePattern(routePattern: string, actualPath: string): boolean {
    const patternParts = routePattern.split('/');
    const pathParts = actualPath.split('/');

    if (patternParts.length !== pathParts.length) return false;

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':') && pathParts[i]) continue;
      if (patternParts[i] !== pathParts[i]) return false;
    }

    return true;
  }
}

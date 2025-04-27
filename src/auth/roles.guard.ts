// src/auth/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PROTECTED_ROUTES } from './route-registry';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user: { role: string };
      route?: { path: string };
      url: string;
    }>();
    const routePath = this.getRoutePath(request);
    const { user } = request;

    const routeConfig = PROTECTED_ROUTES.find(
      (r) => r.path === routePath || this.matchRoutePattern(r.path, routePath),
    );

    if (!routeConfig) return false;

    const permissions = Array.isArray(routeConfig.permissions?.[user.role])
      ? (routeConfig.permissions[user.role] as string[])
      : [];
    return permissions.length > 0;
  }

  private getRoutePath(request: {
    route?: { path: string };
    url: string;
  }): string {
    const routePath = request.route?.path;
    const urlPath = request.url.split('?')[0];
    return routePath || urlPath;
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

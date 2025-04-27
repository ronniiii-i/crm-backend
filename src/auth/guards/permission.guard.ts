// src/auth/permission.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RouteRegistry } from '../route-registry';
import { Permission, UserWithDepartments } from '../permission-types';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private routeRegistry: RouteRegistry,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user: UserWithDepartments;
      route?: { path?: string };
      url: string;
    }>();
    const { user } = request;
    const requiredPermission = this.reflector.get<Permission>(
      'permission',
      context.getHandler(),
    );

    // If no specific permission required, allow access
    if (!requiredPermission) return true;

    const path = request.route?.path ?? request.url.split('?')[0];
    const route = await this.routeRegistry.findRoute(path);

    // If route not found in registry, deny access
    if (!route) return false;

    // Get permissions for user's role
    const rolePermissions = route.permissions[user.role];

    // Check if user's role has the required permission
    return Array.isArray(rolePermissions)
      ? rolePermissions.includes(requiredPermission)
      : false;
  }
}

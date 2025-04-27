// src/auth/permission.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { Permission } from './permission-types';
import { PROTECTED_ROUTES } from './route-registry';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const { user } = request as Request & { user: { role: string } };
    const requiredPermission = this.reflector.get<Permission>(
      'permission',
      context.getHandler(),
    );

    if (!requiredPermission) return true;

    const routePath = request.path; // Extract the route path from the request object
    const routeConfig = PROTECTED_ROUTES.find((r) => r.path === routePath);
    if (!routeConfig) return false;

    const userPermissions = Array.isArray(
      (routeConfig.permissions as Record<string, Permission[]>)[user.role],
    )
      ? (routeConfig.permissions as Record<string, Permission[]>)[user.role]
      : [];
    if (!userPermissions || !Array.isArray(userPermissions)) {
      return false;
    }
    return userPermissions.includes(requiredPermission);
  }
}

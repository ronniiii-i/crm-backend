// src/auth/permission.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RouteRegistry } from '../route-registry';
import { Permission, UserWithDepartments } from '../permission-types';
import { PermissionResolutionService } from '../services/permission-resolution.service';
import { PrismaService } from '../../prisma/prisma.service';
import { getTenantId } from '../../tenant/tenant-context';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private routeRegistry: RouteRegistry,
    private permissionResolution: PermissionResolutionService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user: UserWithDepartments;
      route?: { path?: string };
      url: string;
    }>();
    const { user } = request;
    if (!user) return false;

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

    // Resolve the module backing the route so the hybrid ACL can be applied.
    const tenantId = (user as any).tenantId ?? getTenantId();
    const module = tenantId
      ? await this.prisma.withTenant(tenantId, (tx) =>
          tx.module.findFirst({ where: { path: route.path } }),
        )
      : await this.prisma.module.findFirst({ where: { path: route.path } });

    // When the route maps to a known module, the effective permission set is
    // authoritative — falling back to the static role table would silently
    // ignore REVOKE overrides.
    if (module) {
      return this.permissionResolution.hasPermission(
        user,
        module.id,
        requiredPermission as any,
      );
    }

    // Route is not backed by a module table entry: fall back to the static
    // role permission table.
    const rolePermissions = route.permissions?.[user.role];
    return Array.isArray(rolePermissions)
      ? rolePermissions.includes(requiredPermission)
      : false;
  }
}

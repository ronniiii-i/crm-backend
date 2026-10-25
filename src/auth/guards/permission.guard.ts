import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { SYSTEM_ADMIN_ROUTE_KEY } from '../decorators/system-admin-route.decorator';
import { TENANT_ADMIN_ONLY_KEY } from '../decorators/tenant-admin.decorator';
import { PERMISSION_KEY, PermissionMetadata } from '../decorators/permission.decorator';
import { PermissionResolutionService } from '../services/permission-resolution.service';
import { getTenantId } from '../../tenant/tenant-context';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionResolution: PermissionResolutionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const isSystemAdmin = this.reflector.getAllAndOverride<boolean>(
      SYSTEM_ADMIN_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isSystemAdmin) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Forbidden');
    }

    const tenantAdminOnly = this.reflector.getAllAndOverride<boolean>(
      TENANT_ADMIN_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (tenantAdminOnly) {
      if (user.isTenantAdmin) {
        return true;
      }
      throw new ForbiddenException('Tenant admin access required');
    }

    const permissionMeta = this.reflector.getAllAndOverride<PermissionMetadata>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!permissionMeta) {
      return true;
    }

    const tenantId = user.tenantId ?? getTenantId();
    if (!tenantId) {
      throw new ForbiddenException('Forbidden');
    }

    const allowed = await this.permissionResolution.hasPermission({
      userId: user.id ?? user.sub,
      tenantId,
      moduleKey: permissionMeta.moduleKey,
      action: permissionMeta.action,
      roleId: user.roleId,
      departmentId: user.departmentId ?? null,
      managedDepartmentId: user.managedDepartmentId ?? null,
      dataScope: user.dataScope,
      isTenantAdmin: user.isTenantAdmin,
    });

    if (!allowed) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}

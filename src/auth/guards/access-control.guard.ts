import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { PermissionResolutionService } from '../services/permission-resolution.service';

/**
 * Legacy composite guard — now delegates entirely to PermissionGuard.
 * RolesGuard and DepartmentGuard have been removed as part of the Phase 2
 * migration to dynamic, table-driven roles and permissions.
 */
@Injectable()
export class AccessControlGuard extends AuthGuard('jwt') {
  private permissionGuard: PermissionGuard;

  constructor(
    reflector: Reflector,
    permissionResolution: PermissionResolutionService,
  ) {
    super();
    this.permissionGuard = new PermissionGuard(reflector, permissionResolution);
  }

  async canActivate(context: ExecutionContext) {
    const baseAuth = await super.canActivate(context);
    if (!baseAuth) return false;
    return this.permissionGuard.canActivate(context);
  }
}

import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from './roles.guard';
import { DepartmentGuard } from './department.guard';
import { PermissionGuard } from './permission.guard';

@Injectable()
export class AccessControlGuard extends AuthGuard('jwt') {
  constructor(
    private rolesGuard: RolesGuard,
    private deptGuard: DepartmentGuard,
    private permissionGuard: PermissionGuard,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    const baseAuth = await super.canActivate(context);
    if (!baseAuth) return false;

    // Each guard is evaluated in turn; the first denial short-circuits.
    // RolesGuard is synchronous, DepartmentGuard and PermissionGuard are not.
    if (!this.rolesGuard.canActivate(context)) return false;
    if (!(await this.deptGuard.canActivate(context))) return false;
    return this.permissionGuard.canActivate(context);
  }
}

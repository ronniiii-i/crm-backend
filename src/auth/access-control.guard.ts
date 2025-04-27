// src/auth/access-control.guard.ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from './roles.guard';
import { DepartmentGuard } from './department.guard';

@Injectable()
export class AccessControlGuard extends AuthGuard('jwt') {
  constructor(
    private rolesGuard: RolesGuard,
    private deptGuard: DepartmentGuard,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    const baseAuth = await super.canActivate(context);
    if (!baseAuth) return false;

    return (
      this.rolesGuard.canActivate(context) &&
      this.deptGuard.canActivate(context)
    );
  }
}

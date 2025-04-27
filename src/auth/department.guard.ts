// src/auth/department.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class DepartmentGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredDept = this.reflector.get<string>(
      'department',
      context.getHandler(),
    );
    if (!requiredDept) return true;

    const request = context.switchToHttp().getRequest<{
      user: { departmentId: string; managedDepartmentId: string };
    }>();
    const { user } = request;
    return (
      user.departmentId === requiredDept ||
      user.managedDepartmentId === requiredDept
    );
  }
}

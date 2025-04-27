// test/auth/acl.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessControlGuard } from '../../src/auth/access-control.guard';
import { RolesGuard } from '../../src/auth/roles.guard';
import { DepartmentGuard } from '../../src/auth/department.guard';
import { PermissionGuard } from '../../src/auth/permission.guard';
import { JwtAuthGuard } from '../../src/auth/jwt-auth.guard';
import { PROTECTED_ROUTES } from '../../src/auth/route-registry';

describe('ACL System', () => {
  let reflector: Reflector;
  let rolesGuard: RolesGuard;
  let deptGuard: DepartmentGuard;
  let permGuard: PermissionGuard;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Reflector,
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: () => true },
        },
        RolesGuard,
        DepartmentGuard,
        PermissionGuard,
        AccessControlGuard,
      ],
    }).compile();

    reflector = module.get<Reflector>(Reflector);
    rolesGuard = module.get<RolesGuard>(RolesGuard);
    deptGuard = module.get<DepartmentGuard>(DepartmentGuard);
    permGuard = module.get<PermissionGuard>(PermissionGuard);
  });

  it('should allow ADMIN access to admin-only route', () => {
    const context = createMockContext('/test-acl/admin-only', {
      role: 'ADMIN',
    });
    expect(rolesGuard.canActivate(context)).toBe(true);
  });

  it('should block STAFF from finance data', () => {
    const context = createMockContext('/test-acl/finance-data', {
      role: 'STAFF',
      department: { name: 'IT' },
    });
    expect(deptGuard.canActivate(context)).toBe(false);
  });

  it('should allow HOD with CREATE permission', () => {
    const context = createMockContext(
      '/test-acl/create-operation',
      { role: 'HOD' },
      'CREATE',
    );
    expect(permGuard.canActivate(context)).toBe(true);
  });

  interface User {
    role: string;
    department?: { name: string };
  }

  function createMockContext(path: string, user: User, permission?: string) {
    // Find matching route config
    const routeConfig = PROTECTED_ROUTES.find(
      (r) => r.path === path || path.startsWith(r.path.split(':')[0]),
    );

    return {
      switchToHttp: () => ({
        getRequest: () => ({
          route: { path },
          url: path,
          user,
        }),
      }),
      getHandler: () => {
        return permission
          ? {
              permission,
              ...(routeConfig ? { routeConfig } : {}),
            }
          : {};
      },
    } as ExecutionContext;
  }
});

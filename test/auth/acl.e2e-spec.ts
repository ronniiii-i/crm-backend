// test/auth/acl.e2e-spec.ts
//
// Repaired from the previously fully commented-out suite. The old file
// imported `src/auth/access-control.guard` and `PROTECTED_ROUTES`; both were
// replaced during the multi-tenant work by:
//   * `src/auth/guards/access-control.guard` (composes Jwt + Roles +
//     Department + Permission guards)
//   * `src/auth/routes.ts` (`ALL_ROUTES`) as the source of truth for the
//     role × module permission matrix
//
// The hybrid-ACL resolution tests live in
// `test/acl/permission-resolution.e2e-spec.ts`.

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../src/auth/guards/roles.guard';
import { DepartmentGuard } from '../../src/auth/guards/department.guard';
import { RouteRegistry } from '../../src/auth/route-registry';
import { ALL_ROUTES } from '../../src/auth/routes';
import {
  Permission,
  Department,
  UserWithDepartments,
} from '../../src/auth/permission-types';

/**
 * Builds an `ExecutionContext` whose handler carries real `roles` metadata so
 * the real `Reflector` can read it back.
 */
function createMockContext(
  path: string,
  user: Partial<UserWithDepartments>,
  requiredRoles: string[] = [],
): ExecutionContext {
  const handler = () => undefined;
  Reflect.defineMetadata('roles', requiredRoles, handler);

  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({
        user,
        route: { path },
        url: path,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('ACL System', () => {
  let rolesGuard: RolesGuard;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Reflector,
        { provide: 'REFLECTOR_OVERRIDE', useValue: {} },
        RolesGuard,
      ],
    }).compile();

    rolesGuard = module.get<RolesGuard>(RolesGuard);
  });

  it('should allow ADMIN access to admin-only route', () => {
    const context = createMockContext(
      '/test-acl/admin-only',
      { role: 'ADMIN' },
      ['ADMIN'],
    );
    expect(rolesGuard.canActivate(context)).toBe(true);
  });

  it('should block STAFF from admin-only route', () => {
    const context = createMockContext(
      '/test-acl/admin-only',
      { role: 'STAFF' },
      ['ADMIN'],
    );
    expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should allow a route without role requirements', () => {
    const context = createMockContext('/test-acl/open', { role: 'STAFF' }, []);
    expect(rolesGuard.canActivate(context)).toBe(true);
  });

  it('should deny an unauthenticated request', () => {
    const context = createMockContext('/test-acl/admin-only', {} as any, [
      'ADMIN',
    ]);
    expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
  });
});

describe('DepartmentGuard', () => {
  let deptGuard: DepartmentGuard;

  const routeRegistryStub = {
    findRoute: jest.fn(async (path: string) =>
      ALL_ROUTES.find((r) => r.path === path),
    ),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Reflector,
        { provide: RouteRegistry, useValue: routeRegistryStub },
        DepartmentGuard,
      ],
    }).compile();

    deptGuard = module.get<DepartmentGuard>(DepartmentGuard);
  });

  it('should block STAFF from finance data', async () => {
    const context = createMockContext('/finance/expense-tracking', {
      role: 'STAFF',
      department: { name: Department.IT },
    } as any);

    await expect(deptGuard.canActivate(context)).resolves.toBe(false);
  });

  it('should allow STAFF into their own department data', async () => {
    const context = createMockContext('/it/asset-management', {
      role: 'STAFF',
      department: { name: Department.IT },
    } as any);

    await expect(deptGuard.canActivate(context)).resolves.toBe(true);
  });

  it('should allow ADMIN into every department', async () => {
    const context = createMockContext('/finance/expense-tracking', {
      role: 'ADMIN',
    } as any);

    await expect(deptGuard.canActivate(context)).resolves.toBe(true);
  });
});

describe('ALL_ROUTES permission matrix', () => {
  const ROLES = ['ADMIN', 'HOD', 'LEAD', 'STAFF'] as const;

  it('exposes a non-empty route table', () => {
    expect(ALL_ROUTES.length).toBeGreaterThan(0);
  });

  it('gives every route an entry for all four roles', () => {
    for (const route of ALL_ROUTES) {
      for (const role of ROLES) {
        expect(Array.isArray(route.permissions?.[role])).toBe(true);
      }
    }
  });

  it('never grants DELETE to STAFF', () => {
    for (const route of ALL_ROUTES) {
      expect(route.permissions?.STAFF ?? []).not.toContain(Permission.DELETE);
    }
  });

  it('always lets ADMIN read every module', () => {
    for (const route of ALL_ROUTES) {
      expect(route.permissions?.ADMIN ?? []).toContain(Permission.VIEW);
    }
  });

  it('keeps every route path unique', () => {
    const paths = ALL_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('declares a department for every departmental route', () => {
    for (const route of ALL_ROUTES) {
      if (route.department) {
        expect(Object.values(Department)).toContain(route.department);
      }
    }
  });
});

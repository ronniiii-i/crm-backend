// test/rbac/rbac-matrix.e2e-spec.ts
//
// Exhaustive role × module matrix test.
//
// `src/auth/routes.ts` (ALL_ROUTES) is the single source of truth for
// role-based module access and is what the seed script writes into
// `RoleModulePermission`. These tests assert the invariants that the whole
// system relies on, so an accidental widening (e.g. STAFF gaining DELETE)
// fails the build.

import { Role, PermissionType } from '@prisma/client';
import { ALL_ROUTES } from '../../src/auth/routes';
import { Permission, Department } from '../../src/auth/permission-types';

/** The module groups declared by the specification. */
const SPEC_MODULES = [
  'dashboard',
  'user-management',
  'notifications',
  'settings',
  'finance',
  'it',
  'sales',
  'customer-support',
  'hr',
  'administration',
  'operations',
] as const;

const ALL_ROLES = [Role.ADMIN, Role.HOD, Role.LEAD, Role.STAFF] as const;
const ALL_PERMISSIONS = [
  Permission.VIEW,
  Permission.CREATE,
  Permission.EDIT,
  Permission.DELETE,
];

describe('RBAC matrix', () => {
  it('covers every module group declared in the spec', () => {
    const paths = ALL_ROUTES.map((r) => r.path);
    for (const group of SPEC_MODULES) {
      expect(
        paths.some((p) => p === `/${group}` || p.startsWith(`/${group}/`)),
      ).toBe(true);
    }
  });

  it('defines permissions for all four roles on every route', () => {
    for (const route of ALL_ROUTES) {
      for (const role of ALL_ROLES) {
        expect(route.permissions[role]).toBeDefined();
        expect(Array.isArray(route.permissions[role])).toBe(true);
      }
    }
  });

  it('only ever uses known permission types', () => {
    for (const route of ALL_ROUTES) {
      for (const role of ALL_ROLES) {
        for (const permission of route.permissions[role]) {
          expect(ALL_PERMISSIONS).toContain(permission);
        }
      }
    }
  });

  it('keeps every route path unique', () => {
    const paths = ALL_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('keeps every route id unique', () => {
    const ids = ALL_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares a valid department for every departmental route', () => {
    for (const route of ALL_ROUTES) {
      if (!route.department) continue;
      const departments = Array.isArray(route.department)
        ? route.department
        : [route.department];
      for (const department of departments) {
        expect(Object.values(Department)).toContain(department);
      }
    }
  });

  describe('ADMIN', () => {
    it('can view, edit and delete across every module', () => {
      for (const route of ALL_ROUTES) {
        const perms = route.permissions[Role.ADMIN];
        expect(perms).toContain(Permission.VIEW);
        expect(perms).toContain(Permission.EDIT);
        expect(perms).toContain(Permission.DELETE);
      }
    });
  });

  describe('HOD', () => {
    it('never holds CREATE on any module', () => {
      for (const route of ALL_ROUTES) {
        expect(route.permissions[Role.HOD]).not.toContain(Permission.CREATE);
      }
    });
  });

  describe('LEAD', () => {
    it('never holds DELETE on any module', () => {
      for (const route of ALL_ROUTES) {
        expect(route.permissions[Role.LEAD]).not.toContain(Permission.DELETE);
      }
    });

    it('never holds CREATE on any module', () => {
      for (const route of ALL_ROUTES) {
        expect(route.permissions[Role.LEAD]).not.toContain(Permission.CREATE);
      }
    });
  });

  describe('STAFF', () => {
    it('never holds DELETE on any module', () => {
      for (const route of ALL_ROUTES) {
        expect(route.permissions[Role.STAFF]).not.toContain(Permission.DELETE);
      }
    });

    it('never holds CREATE on any module', () => {
      for (const route of ALL_ROUTES) {
        expect(route.permissions[Role.STAFF]).not.toContain(Permission.CREATE);
      }
    });
  });

  describe('administrative modules', () => {
    const adminOnly = ALL_ROUTES.filter(
      (r) => r.path === '/user-management',
    );

    it('restricts user management to ADMIN', () => {
      for (const route of adminOnly) {
        for (const role of [Role.HOD, Role.LEAD, Role.STAFF]) {
          expect(route.permissions[role]).toEqual([]);
        }
      }
    });
  });

  describe('PermissionType enum alignment', () => {
    it('exposes the four permission types used by Prisma', () => {
      expect(Object.values(PermissionType).sort()).toEqual(
        ['CREATE', 'DELETE', 'EDIT', 'VIEW'].sort(),
      );
    });

    it('exposes the four permission types used by the code enum', () => {
      expect(Object.values(Permission).sort()).toEqual(
        ['CREATE', 'DELETE', 'EDIT', 'VIEW'].sort(),
      );
    });
  });
});

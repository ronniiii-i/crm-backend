import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Project, User, Prisma } from '@prisma/client';
import { getTenantId } from '../tenant/tenant-context';

/**
 * Minimal user shape accepted by DataFilterService.
 * Accepts either the old string-slug role (Phase 1 compatibility) or a
 * Phase 2 role object.  `dataScope` drives the actual filtering logic.
 */
interface FilterUser {
  id: string;
  /** Role slug string (e.g. 'department_head') or stringified role for compat. */
  role?: string | { slug?: string; dataScope?: string } | null;
  /** Phase 2: role data scope from JWT or user object. */
  dataScope?: string;
  tenantId?: string;
  departmentId?: string;
  managedDepartmentId?: string;
}

@Injectable()
export class DataFilterService {
  constructor(private prisma: PrismaService) {}

  /** Run `fn` in the current request's tenant transaction when available. */
  private scoped<T>(
    tenantId: string | undefined,
    fn: (db: Prisma.TransactionClient | PrismaService) => Promise<T>,
  ): Promise<T> {
    const resolved = tenantId ?? getTenantId();
    if (!resolved) return fn(this.prisma);
    return this.prisma.withTenant(resolved, (tx) => fn(tx));
  }

  /**
   * Resolve effective data scope string from either Phase 1 role strings or
   * Phase 2 role objects / dataScope fields.
   */
  private resolveScope(user: FilterUser): string {
    // Phase 2: explicit dataScope wins
    if (user.dataScope) return user.dataScope;

    // Phase 2: role object with dataScope
    if (user.role && typeof user.role === 'object' && user.role.dataScope) {
      return user.role.dataScope;
    }

    // Phase 1 / legacy string-role compatibility
    const slug =
      typeof user.role === 'string'
        ? user.role
        : typeof user.role === 'object' && user.role?.slug
          ? user.role.slug
          : null;

    if (!slug) return 'SELF';

    const upper = slug.toUpperCase();
    if (upper === 'ADMIN' || upper === 'TENANT_ADMIN') return 'TENANT';
    if (upper === 'HOD' || upper === 'DEPARTMENT_HEAD') return 'DEPARTMENT';
    if (upper === 'LEAD' || upper === 'TEAM_LEAD') return 'TEAM';
    return 'SELF';
  }

  /**
   * Filters projects based on user's access rights.
   */
  async filterProjects(user: FilterUser): Promise<Project[]> {
    const scope = this.resolveScope(user);
    const whereConditions: any[] = [];

    // Every user can see projects they are directly on
    whereConditions.push({
      OR: [{ userId: user.id }, { teamMembers: { some: { userId: user.id } } }],
    });

    // Department-scoped: see all projects from managed/own department
    if (
      (scope === 'DEPARTMENT' || scope === 'TEAM') &&
      (user.managedDepartmentId || user.departmentId)
    ) {
      const deptId = user.managedDepartmentId ?? user.departmentId;
      whereConditions.push({
        teamMembers: { some: { user: { departmentId: deptId } } },
      });
    }

    // Tenant-wide: bypass all user filters (RLS still scopes to tenant)
    if (scope === 'TENANT') {
      return this.scoped(user.tenantId, (db) => db.project.findMany());
    }

    return this.scoped(user.tenantId, (db) =>
      db.project.findMany({
        where: { OR: whereConditions },
      }),
    );
  }

  /**
   * Filters users based on hierarchy.
   */
  async filterUsers(user: FilterUser): Promise<User[]> {
    const scope = this.resolveScope(user);
    const baseConditions: Array<any> = [];

    // Tenant-wide: see everyone (RLS remains the authority)
    if (scope === 'TENANT') {
      return this.scoped(user.tenantId, (db) => db.user.findMany());
    }

    // Department-scoped: see own department members
    if (scope === 'DEPARTMENT') {
      const deptId = user.managedDepartmentId || user.departmentId;
      if (deptId) {
        baseConditions.push({ departmentId: deptId });
      }
    }

    // Team-scoped: see team members led by this user
    if (scope === 'TEAM') {
      baseConditions.push({
        teamMemberships: { some: { team: { leadUserId: user.id } } },
      });
    }

    // Self-scoped: only themselves
    if (scope === 'SELF') {
      return this.scoped(user.tenantId, (db) =>
        db.user.findMany({ where: { id: user.id } }),
      );
    }

    if (baseConditions.length === 0) {
      return this.scoped(user.tenantId, (db) =>
        db.user.findMany({ where: { id: user.id } }),
      );
    }

    return this.scoped(user.tenantId, (db) =>
      db.user.findMany({
        where: { OR: baseConditions },
      }),
    );
  }
}

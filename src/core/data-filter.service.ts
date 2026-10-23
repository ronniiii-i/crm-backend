import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, Project, User, Prisma } from '@prisma/client';
import { getTenantId } from '../tenant/tenant-context';

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
   * Filters projects based on user's access rights
   */
  async filterProjects(user: {
    id: string;
    role: Role;
    tenantId?: string;
    departmentId?: string;
    managedDepartmentId?: string;
  }): Promise<Project[]> {
    const whereConditions: any[] = [];

    // Staff can see their own projects
    whereConditions.push({
      OR: [{ userId: user.id }, { teamMembers: { some: { userId: user.id } } }],
    });

    // HODs can see department projects
    if (user.role === 'HOD' && user.managedDepartmentId) {
      whereConditions.push({
        teamMembers: {
          some: {
            user: {
              departmentId: user.managedDepartmentId,
            },
          },
        },
      });
    }

    // Admins bypass all filters (but remain tenant-scoped by RLS)
    if (user.role === 'ADMIN') {
      return this.scoped(user.tenantId, (db) => db.project.findMany());
    }

    return this.scoped(user.tenantId, (db) =>
      db.project.findMany({
        where: { OR: whereConditions },
      }),
    );
  }

  /**
   * Filters users based on hierarchy
   */
  async filterUsers(viewer: {
    id: string;
    role: Role;
    tenantId?: string;
    departmentId?: string;
    managedDepartmentId?: string;
  }): Promise<User[]> {
    const baseConditions: Array<any> = [];

    // HODs see their department members
    const hodDeptId = viewer.managedDepartmentId || viewer.departmentId;
    if (viewer.role === 'HOD' && hodDeptId) {
      baseConditions.push({
        departmentId: hodDeptId,
      });
    }

    // Team Leads see their team members (via TeamMember relation)
    if (viewer.role === 'LEAD') {
      baseConditions.push({
        teamMemberships: { some: { team: { leadUserId: viewer.id } } },
      });
    }

    // Staff can only see themselves
    if (viewer.role === 'STAFF') {
      return this.scoped(viewer.tenantId, (db) =>
        db.user.findMany({
          where: { id: viewer.id },
        }),
      );
    }

    // Admins see everyone (but remain tenant-scoped by RLS)
    if (viewer.role === 'ADMIN') {
      return this.scoped(viewer.tenantId, (db) => db.user.findMany());
    }

    if (baseConditions.length === 0) {
      return this.scoped(viewer.tenantId, (db) =>
        db.user.findMany({ where: { id: viewer.id } }),
      );
    }

    return this.scoped(viewer.tenantId, (db) =>
      db.user.findMany({
        where: { OR: baseConditions },
      }),
    );
  }
}

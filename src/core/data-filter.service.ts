// src/core/data-filter.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, Project, User } from '@prisma/client';

@Injectable()
export class DataFilterService {
  constructor(private prisma: PrismaService) {}

  /**
   * Filters projects based on user's access rights
   */
  async filterProjects(user: {
    id: string;
    role: Role;
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

    // Admins bypass all filters
    if (user.role === 'ADMIN') {
      return this.prisma.project.findMany();
    }

    return this.prisma.project.findMany({
      where: { OR: whereConditions },
    });
  }

  /**
   * Filters users based on hierarchy
   */
  async filterUsers(viewer: {
    id: string;
    role: Role;
    departmentId?: string;
  }): Promise<User[]> {
    const baseConditions: Array<{
      departmentId?: string;
      managedBy?: { id: string };
    }> = [];

    // HODs see their department members
    if (viewer.role === 'HOD' && viewer.departmentId) {
      baseConditions.push({
        departmentId: viewer.departmentId,
      });
    }

    // Team Leads see their team members
    if (viewer.role === 'LEAD') {
      baseConditions.push({
        managedBy: { id: viewer.id },
      });
    }

    // Admins see everyone
    if (viewer.role === 'ADMIN') {
      return this.prisma.user.findMany();
    }

    return this.prisma.user.findMany({
      where: { OR: baseConditions },
    });
  }
}

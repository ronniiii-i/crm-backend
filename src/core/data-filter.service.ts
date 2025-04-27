// src/core/data-filter.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class DataFilterService {
  constructor(private prisma: PrismaService) {}

  async filterProjects(user: {
    sub: string;
    role: Role;
    departmentId?: string;
    managedDepartmentId?: string;
  }) {
    const baseConditions = [
      { userId: user.sub }, // Own projects
      { teamMembers: { some: { userId: user.sub } } }, // Team projects
    ];

    if (user.role === 'ADMIN') {
      return this.prisma.project.findMany(); // Admins see all
    }

    if (user.managedDepartmentId) {
      baseConditions.push({
        teamMembers: {
          some: {
            userId: user.sub,
          },
        },
      });
    }

    return this.prisma.project.findMany({
      where: { OR: baseConditions },
    });
  }
}

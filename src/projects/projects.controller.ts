// src/projects/projects.controller.ts
import {
  Controller,
  Get,
  UseGuards,
  Param,
  ForbiddenException,
} from '@nestjs/common';
import { AccessControlGuard } from '../auth/access-control.guard';
import { Roles } from '../auth/roles.decorator';
import { User } from '../auth/user.decorator';
import { DataFilterService } from '../core/data-filter.service';
import { Role } from '@prisma/client';

@Controller('projects')
@UseGuards(AccessControlGuard)
export class ProjectsController {
  constructor(private dataFilter: DataFilterService) {}

  @Get()
  @Roles('ADMIN', 'HOD', 'STAFF') // Requires these roles
  async getAllProjects(
    @User()
    user: {
      sub: string;
      role: Role;
      departmentId?: string;
      managedDepartmentId?: string;
    },
  ) {
    return this.dataFilter.filterProjects({ ...user, id: user.sub });
  }

  @Get(':id')
  @Roles('ADMIN', 'HOD', 'STAFF')
  async getProject(
    @Param('id') id: string,
    @User()
    user: {
      sub: string;
      role: Role;
      departmentId?: string;
      managedDepartmentId?: string;
    },
  ) {
    const projects = await this.dataFilter.filterProjects({
      ...user,
      id: user.sub,
    });
    const project = projects.find((p) => p.id === id);

    if (!project) {
      throw new ForbiddenException('Project not found or access denied');
    }

    return project;
  }
}

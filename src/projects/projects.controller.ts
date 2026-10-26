import {
  Controller,
  Get,
  UseGuards,
  Param,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../auth/decorators/permission.decorator';
import { User } from '../auth/decorators/user.decorator';
import { DataFilterService } from '../core/data-filter.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private dataFilter: DataFilterService) {}

  @Get()
  @RequirePermission('projects', 'VIEW')
  async getAllProjects(
    @User()
    user: {
      sub?: string;
      id?: string;
      dataScope?: string;
      isTenantAdmin?: boolean;
      departmentId?: string;
      managedDepartmentId?: string;
      tenantId?: string;
    },
  ) {
    return this.dataFilter.filterProjects({
      ...user,
      id: user.id ?? user.sub ?? '',
    });
  }

  @Get(':id')
  @RequirePermission('projects', 'VIEW')
  async getProject(
    @Param('id') id: string,
    @User()
    user: {
      sub?: string;
      id?: string;
      dataScope?: string;
      isTenantAdmin?: boolean;
      departmentId?: string;
      managedDepartmentId?: string;
      tenantId?: string;
    },
  ) {
    const projects = await this.dataFilter.filterProjects({
      ...user,
      id: user.id ?? user.sub ?? '',
    });
    const project = projects.find((p) => p.id === id);

    if (!project) {
      throw new ForbiddenException('Project not found or access denied');
    }

    return project;
  }
}

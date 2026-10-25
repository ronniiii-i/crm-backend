import { Controller, Get, Post, Body, Patch, Delete, Param, UseGuards } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAdminOnly } from '../auth/decorators/tenant-admin.decorator';
import { User } from '../auth/decorators/user.decorator';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Controller('departments')
@UseGuards(JwtAuthGuard)
export class DepartmentsController {
  constructor(private readonly service: DepartmentsService) {}

  @Get()
  @TenantAdminOnly()
  list(@User() user: any) {
    return this.service.list(user.tenantId);
  }

  @Get('overview')
  @TenantAdminOnly()
  overview(@User() user: any) {
    return this.service.overview(user.tenantId);
  }

  @Get(':id')
  @TenantAdminOnly()
  get(@User() user: any, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Post()
  @TenantAdminOnly()
  create(@User() user: any, @Body() dto: CreateDepartmentDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id')
  @TenantAdminOnly()
  update(@User() user: any, @Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @TenantAdminOnly()
  remove(@User() user: any, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}

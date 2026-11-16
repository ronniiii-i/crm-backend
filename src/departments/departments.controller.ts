import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
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

  /**
   * Aggregated department cards. Scoped by role: admins see every department,
   * heads see their own, and team leads/staff see their own with reduced
   * counts. The service enforces the scope from the authenticated user.
   */
  @Get('overview')
  overview(@User() user: any) {
    return this.service.overview(user);
  }

  @Get(':deptId/summary')
  summary(@User() user: any, @Param('deptId') deptId: string) {
    return this.service.summary(user, deptId);
  }

  @Get(':id')
  @TenantAdminOnly()
  get(@User() user: any, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Post()
  @TenantAdminOnly()
  create(
    @User() user: any,
    @Body() dto: CreateDepartmentDto,
    @Ip() ip?: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.service.create(user.tenantId, dto, {
      actorId: user.id,
      ip,
      userAgent,
      requestId,
    });
  }

  @Patch(':id')
  @TenantAdminOnly()
  update(
    @User() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @TenantAdminOnly()
  remove(@User() user: any, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}

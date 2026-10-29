import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Delete,
  Param,
  UseGuards,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAdminOnly } from '../auth/decorators/tenant-admin.decorator';
import { User } from '../auth/decorators/user.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Controller('roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private readonly service: RolesService) {}

  @Get()
  @TenantAdminOnly()
  list(@User() user: any) {
    return this.service.list(user.tenantId);
  }

  @Get('assignable')
  assignable(@User() user: any) {
    return this.service.assignable(user.tenantId, user);
  }

  @Get(':id')
  @TenantAdminOnly()
  get(@User() user: any, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Post()
  @TenantAdminOnly()
  create(@User() user: any, @Body() dto: CreateRoleDto) {
    return this.service.create(user.tenantId, user, dto);
  }

  @Patch(':id')
  @TenantAdminOnly()
  update(
    @User() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @TenantAdminOnly()
  remove(@User() user: any, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}

import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAdminOnly } from '../auth/decorators/tenant-admin.decorator';
import { User } from '../auth/decorators/user.decorator';

@Controller('access-control')
@UseGuards(JwtAuthGuard)
export class AccessControlController {
  constructor(private readonly service: AccessControlService) {}

  @Get('catalog')
  @TenantAdminOnly()
  catalog(@User() user: any) {
    return this.service.catalog(user.tenantId);
  }

  @Get('roles/:id/permissions')
  @TenantAdminOnly()
  rolePermissions(@User() user: any, @Param('id') id: string) {
    return this.service.rolePermissions(user.tenantId, id);
  }

  @Put('roles/:id/permissions')
  @TenantAdminOnly()
  updateRolePermissions(
    @User() user: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.updateRolePermissions(
      user.tenantId,
      id,
      body?.grants ?? body,
    );
  }
}

import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAdminOnly } from '../auth/decorators/tenant-admin.decorator';
import { AllowLockedTenant } from '../auth/decorators/allow-locked-tenant.decorator';
import { User } from '../auth/decorators/user.decorator';
import { TenantSettingsService } from './tenant-settings.service';

@Controller('tenant/settings')
@UseGuards(JwtAuthGuard)
@TenantAdminOnly()
@AllowLockedTenant()
export class TenantSettingsController {
  constructor(private readonly service: TenantSettingsService) {}

  @Get()
  get(@User() user: any) {
    return this.service.get(user.tenantId);
  }

  @Patch()
  update(@User() user: any, @Body() body: any) {
    return this.service.update(user.tenantId, body);
  }
}

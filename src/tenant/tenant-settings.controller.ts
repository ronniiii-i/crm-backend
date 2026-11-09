import { Controller, Get, Patch, Body } from '@nestjs/common';
import { TenantAdminOnly } from '../auth/decorators/tenant-admin.decorator';
import { AllowLockedTenant } from '../auth/decorators/allow-locked-tenant.decorator';
import { User } from '../auth/decorators/user.decorator';
import { TenantSettingsService } from './tenant-settings.service';

interface TenantSettingsUser {
  sub?: string;
  userId?: string;
  tenantId: string;
}

@Controller('tenant/settings')
@TenantAdminOnly()
@AllowLockedTenant()
export class TenantSettingsController {
  constructor(private readonly service: TenantSettingsService) {}

  @Get()
  get(@User() user: TenantSettingsUser) {
    return this.service.get(user.tenantId);
  }

  @Patch()
  update(
    @User() user: TenantSettingsUser,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.update(user.tenantId, body, user.sub ?? user.userId);
  }
}

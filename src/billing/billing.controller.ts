import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAdminOnly } from '../auth/decorators/tenant-admin.decorator';
import { AllowLockedTenant } from '../auth/decorators/allow-locked-tenant.decorator';
import { User } from '../auth/decorators/user.decorator';
import { BillingService } from './billing.service';

@Controller('tenant/billing')
@UseGuards(JwtAuthGuard)
@TenantAdminOnly()
@AllowLockedTenant()
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get()
  get(@User() user: any) {
    return this.service.getBilling(user.tenantId);
  }

  @Post('contact')
  contact(@User() user: any, @Body() body: any) {
    return this.service.contact(user, body);
  }
}

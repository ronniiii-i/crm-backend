import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, TenantModule, AuthModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}

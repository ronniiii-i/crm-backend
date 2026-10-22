// src/dashboard/dashboard.module.ts
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardWidgetsService } from './dashboard-widgets.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [AuthModule, PrismaModule, CacheModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardWidgetsService],
})
export class DashboardModule {}

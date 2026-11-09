import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaService } from './prisma/prisma.service';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';
import { ProjectsModule } from './projects/projects.module';
import { CoreModule } from './core/core.module';
import { CacheModule } from './cache/cache.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { ProfileModule } from './profile/profile.module';
import { TenantModule } from './tenant/tenant.module';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TenantInterceptor } from './tenant/tenant.interceptor';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { TenantMiddleware } from './tenant/tenant.middleware';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { TenantLifecycleGuard } from './tenant/tenant-lifecycle.guard';
import { PermissionGuard } from './auth/guards/permission.guard';
import { SystemAdminGuard } from './system-admin/guards/system-admin.guard';
import { SystemAdminModule } from './system-admin/system-admin.module';
import { RolesModule } from './roles/roles.module';
import { DepartmentsModule } from './departments/departments.module';
import { AccessControlModule } from './access-control/access-control.module';
import { InvitationsModule } from './invitations/invitations.module';
import { PublicModule } from './public/public.module';
import { BillingModule } from './billing/billing.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StorageModule } from './storage/storage.module';
import { TenantSettingsModule } from './tenant/tenant-settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    EmailModule,
    TenantModule,
    RateLimitModule,
    AuthModule,
    PrismaModule,
    ProjectsModule,
    CoreModule,
    DashboardModule,
    CacheModule,
    UsersModule,
    ProfileModule,
    SystemAdminModule,
    RolesModule,
    DepartmentsModule,
    AccessControlModule,
    InvitationsModule,
    PublicModule,
    BillingModule,
    WorkspaceModule,
    NotificationsModule,
    StorageModule,
    TenantSettingsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    {
      provide: APP_GUARD,
      useExisting: RateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantLifecycleGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
    {
      provide: APP_GUARD,
      useClass: SystemAdminGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

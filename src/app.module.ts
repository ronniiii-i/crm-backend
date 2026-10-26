import {
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaService } from './prisma/prisma.service';
import { PrismaModule } from './prisma/prisma.module';
import { MailService } from './mail/mail.service';
import { ProjectsModule } from './projects/projects.module';
import { CoreModule } from './core/core.module';
import { CacheModule } from './cache/cache.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { ProfileModule } from './profile/profile.module';
import { TenantModule } from './tenant/tenant.module';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TenantInterceptor } from './tenant/tenant.interceptor';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
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
import { TenantSettingsController } from './tenant/tenant-settings.controller';
import { TenantSettingsService } from './tenant/tenant-settings.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TenantModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
      {
        name: 'short',
        ttl: 10000,
        limit: 10,
      },
    ]),
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
  ],
  controllers: [AppController, TenantSettingsController],
  providers: [
    AppService,
    PrismaService,
    MailService,
    TenantSettingsService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
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

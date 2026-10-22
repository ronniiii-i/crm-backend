import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
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
import { SessionMiddleware } from './auth/middleware/session.middleware';
import { DashboardModule } from './dashboard/dashboard.module';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { ProfileModule } from './profile/profile.module';
import { TenantModule } from './tenant/tenant.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantInterceptor } from './tenant/tenant.interceptor';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // makes the ConfigModule available everywhere
    }),
    TenantModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 1 minute in milliseconds
        limit: 100, // 100 requests per minute (general API limits)
      },
      {
        name: 'short',
        ttl: 10000, // 10 seconds in milliseconds
        limit: 10, // 10 requests per 10 seconds (burst protection)
      },
      {
        name: 'auth',
        ttl: 3600000, // 1 hour in milliseconds
        limit: 5, // 5 requests per hour (strict auth endpoints)
      },
      {
        name: 'sensitive',
        ttl: 86400000, // 24 hours in milliseconds
        limit: 10, // 10 requests per day (for very sensitive ops)
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
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
    AppService,
    PrismaService,
    MailService,
    // CacheService,
    // JwtService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SessionMiddleware)
      .exclude(
        { path: 'auth/logout', method: RequestMethod.POST },
        // { path: 'auth/login', method: RequestMethod.POST },
        // { path: 'auth/register', method: RequestMethod.POST },
      )
      .forRoutes('*'); // This applies the middleware to all other routes
  }
}

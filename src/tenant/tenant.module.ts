import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TenantMiddleware } from './tenant.middleware';
import { TenantInterceptor } from './tenant.interceptor';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantStateService } from './tenant-state.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../cache/cache.module';
import { JwtModule } from '@nestjs/jwt';
import { requireEnv, optionalEnv } from '../config/env';

@Module({
  imports: [
    PrismaModule,
    CacheModule,
    JwtModule.register({
      // Validated at boot by env.validation.ts — no insecure fallback.
      secret: requireEnv('JWT_SECRET'),
      signOptions: { expiresIn: optionalEnv('JWT_EXPIRES_IN', '1h') },
    }),
  ],
  providers: [
    TenantMiddleware,
    TenantInterceptor,
    TenantResolverService,
    TenantProvisioningService,
    TenantStateService,
  ],
  exports: [
    TenantInterceptor,
    TenantResolverService,
    TenantProvisioningService,
    TenantStateService,
  ],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

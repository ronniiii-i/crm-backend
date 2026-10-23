import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TenantMiddleware } from './tenant.middleware';
import { TenantInterceptor } from './tenant.interceptor';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { requireEnv, optionalEnv } from '../config/env';

@Module({
  imports: [
    PrismaModule,
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
  ],
  exports: [
    TenantInterceptor,
    TenantResolverService,
    TenantProvisioningService,
  ],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}

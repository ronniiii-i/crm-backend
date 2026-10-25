import { Module } from '@nestjs/common';
import { SystemAdminAuthController } from './system-admin-auth.controller';
import { SystemAdminAuthService } from './system-admin-auth.service';
import { SystemAdminTenantsController } from './system-admin-tenants.controller';
import { SystemAdminTenantsService } from './system-admin-tenants.service';
import { SystemAdminStrategy } from './system-admin.strategy';
import { SystemPrismaModule } from '../prisma/system-prisma.module';
import { CacheModule } from '../cache/cache.module';
import { JwtModule } from '@nestjs/jwt';
import { requireEnv, optionalEnv } from '../config/env';

@Module({
  imports: [
    SystemPrismaModule,
    CacheModule,
    JwtModule.register({
      secret: requireEnv('SYSTEM_JWT_SECRET'),
      signOptions: { expiresIn: optionalEnv('SYSTEM_JWT_EXPIRES_IN', '30m') },
    }),
  ],
  controllers: [SystemAdminAuthController, SystemAdminTenantsController],
  providers: [SystemAdminAuthService, SystemAdminTenantsService, SystemAdminStrategy],
  exports: [SystemAdminAuthService],
})
export class SystemAdminModule {}

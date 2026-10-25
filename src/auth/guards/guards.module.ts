import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TenantLifecycleGuard } from '../../tenant/tenant-lifecycle.guard';
import { RouteRegistry } from '../route-registry';
import { CacheModule } from '../../cache/cache.module';
import { AclModule } from '../acl.module';
import { TenantModule } from '../../tenant/tenant.module';
import { JwtModule } from '@nestjs/jwt';
import { requireEnv, optionalEnv } from '../../config/env';
import { AuthModule } from '../auth.module';

@Module({
  imports: [
    CacheModule,
    AclModule,
    TenantModule,
    AuthModule,
    JwtModule.register({
      secret: requireEnv('JWT_SECRET'),
      signOptions: { expiresIn: optionalEnv('JWT_EXPIRES_IN', '1h') },
    }),
  ],
  providers: [
    Reflector,
    PermissionGuard,
    JwtAuthGuard,
    TenantLifecycleGuard,
    RouteRegistry,
  ],
  exports: [PermissionGuard, JwtAuthGuard, TenantLifecycleGuard, Reflector],
})
export class GuardsModule {}

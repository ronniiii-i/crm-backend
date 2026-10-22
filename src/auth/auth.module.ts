// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './services/auth.service';
import { MailService } from '../mail/mail.service';
import { AuthController } from './controllers/auth.controller';
import { AuthAclController } from './controllers/access-control.controller';
import { JwtStrategy } from './jwt.strategy';
import { GuardsModule } from './guards/guards.module';
import { DataFilterService } from '../core/data-filter.service';
import { CacheModule } from '../cache/cache.module';
import { RouteRegistry } from './route-registry';
import { FrontendAdapterService } from './frontend-adapter.service';
import { TenantModule } from '../tenant/tenant.module';
import { AclModule } from './acl.module';
import { requireEnv, optionalEnv } from '../config/env';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: requireEnv('JWT_SECRET'),
      signOptions: { expiresIn: optionalEnv('JWT_EXPIRES_IN', '1h') },
    }),
    CacheModule,
    TenantModule,
    AclModule,
  ],
  providers: [
    AuthService,
    JwtStrategy,
    MailService,
    GuardsModule,
    DataFilterService,
    RouteRegistry,
    FrontendAdapterService,
  ],
  controllers: [AuthController, AuthAclController],
  exports: [
    GuardsModule,
    RouteRegistry,
    FrontendAdapterService,
    JwtModule,
    AclModule,
  ],
})
export class AuthModule {}

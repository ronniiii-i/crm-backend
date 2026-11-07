import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './services/auth.service';
import { AuthController } from './controllers/auth.controller';
import { AuthAclController } from './controllers/access-control.controller';
import { SessionController } from './controllers/session.controller';
import { JwtStrategy } from './jwt.strategy';
import { DataFilterService } from '../core/data-filter.service';
import { CacheModule } from '../cache/cache.module';
import { RouteRegistry } from './route-registry';
import { FrontendAdapterService } from './frontend-adapter.service';
import { TenantModule } from '../tenant/tenant.module';
import { AclModule } from './acl.module';
import { SystemPrismaModule } from '../prisma/system-prisma.module';
import { requireEnv, optionalEnv } from '../config/env';
import { PermissionResolutionService } from './services/permission-resolution.service';
import { SessionStateService } from './services/session-state.service';
import { UserSessionService } from './services/user-session.service';
import { NewDeviceNotifier } from './services/new-device-notifier.service';

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
    SystemPrismaModule,
  ],
  providers: [
    AuthService,
    JwtStrategy,
    DataFilterService,
    RouteRegistry,
    FrontendAdapterService,
    PermissionResolutionService,
    SessionStateService,
    UserSessionService,
    NewDeviceNotifier,
  ],
  controllers: [AuthController, AuthAclController, SessionController],
  exports: [
    PassportModule,
    RouteRegistry,
    FrontendAdapterService,
    JwtModule,
    AclModule,
    PermissionResolutionService,
    SessionStateService,
    UserSessionService,
  ],
})
export class AuthModule {}

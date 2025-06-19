// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
// import { CacheModule } from '@nestjs/cache-manager';
// import * as redisStore from 'cache-manager-redis-store';
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

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'supersecret',
      signOptions: { expiresIn: '1h' },
      // signOptions: { expiresIn: '5m' },
    }),
    CacheModule,
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
  exports: [GuardsModule, RouteRegistry, FrontendAdapterService],
})
export class AuthModule {}

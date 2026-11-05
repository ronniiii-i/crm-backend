import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { optionalEnv, requireEnv } from '../config/env';
import { MemorySlidingWindowStore } from './memory-sliding-window.store';
import {
  RATE_LIMIT_REDIS_CLIENT_FACTORY,
  RedisSlidingWindowStore,
  defaultRateLimitRedisClientFactory,
} from './redis-sliding-window.store';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';

/**
 * Identity-aware rate limiting.
 *
 * The guard is registered here (rather than in `AppModule`) so its
 * dependencies resolve from this module's context. `APP_GUARD` providers are
 * global, and this module is imported once by `AppModule`.
 */
@Module({
  imports: [
    JwtModule.register({
      secret: requireEnv('JWT_SECRET'),
      signOptions: { expiresIn: optionalEnv('JWT_EXPIRES_IN', '1h') },
    }),
  ],
  providers: [
    MemorySlidingWindowStore,
    {
      provide: RATE_LIMIT_REDIS_CLIENT_FACTORY,
      useValue: defaultRateLimitRedisClientFactory,
    },
    RedisSlidingWindowStore,
    RateLimitService,
    RateLimitGuard,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
  exports: [RateLimitService, RateLimitGuard],
})
export class RateLimitModule {}

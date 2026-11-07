import { Module } from '@nestjs/common';
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
 * The guard itself is registered by `AppModule` as the first global guard so
 * it runs before JWT/tenant/permission guards; this module owns its
 * dependencies and exports the guard for that registration.
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
  ],
  exports: [RateLimitService, RateLimitGuard],
})
export class RateLimitModule {}

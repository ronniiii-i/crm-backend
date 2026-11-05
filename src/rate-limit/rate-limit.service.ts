import { Inject, Injectable, Optional } from '@nestjs/common';
import { sha256 } from '../common/request-info';
import {
  buildPolicyDefinitions,
  applyPolicyOverrides,
  type RateLimitPolicyDefinition,
  type RateLimitPolicyName,
  type RateLimitPolicyOverrides,
} from './rate-limit-policy';
import { MemorySlidingWindowStore } from './memory-sliding-window.store';
import { RedisSlidingWindowStore } from './redis-sliding-window.store';
import type { SlidingWindowResult } from './sliding-window.store';

/**
 * Applies the policy matrix to a hashed bucket key.
 *
 * Redis is preferred when available. Any Redis failure falls through to the
 * in-memory store, so a rate-limit check never fails the request with a 500.
 */
@Injectable()
export class RateLimitService {
  private readonly definitions: Record<
    RateLimitPolicyName,
    RateLimitPolicyDefinition
  >;

  constructor(
    private readonly memory: MemorySlidingWindowStore,
    @Optional()
    @Inject(RedisSlidingWindowStore)
    private readonly redis?: RedisSlidingWindowStore,
  ) {
    this.definitions = buildPolicyDefinitions();
  }

  /**
   * Count one request against `policy`.
   *
   * `identityKey` is a composite string built by the guard. It is hashed
   * before storage so raw emails and IP addresses never reach Redis.
   */
  async consume(
    policy: RateLimitPolicyName,
    identityKey: string,
    overrides?: RateLimitPolicyOverrides,
    now: number = Date.now(),
  ): Promise<SlidingWindowResult> {
    const definition = applyPolicyOverrides(
      this.definitions[policy],
      overrides,
    );
    const bucket = sha256(`${policy}:${identityKey}`);

    if (this.redis?.ready) {
      try {
        const result = await this.redis.hit(
          bucket,
          definition.limit,
          definition.windowMs,
          now,
        );
        if (result) return result;
      } catch {
        // The store already logged; use the fallback below.
      }
    }

    return this.memory.hit(bucket, definition.limit, definition.windowMs, now);
  }
}

import { SetMetadata } from '@nestjs/common';
import type { RateLimitPolicyName } from './rate-limit-policy';

export const RATE_LIMIT_KEY = 'rateLimit';
export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';

export interface RateLimitOptions {
  /** Replaces the route-derived policy stack. */
  policy?: RateLimitPolicyName | RateLimitPolicyName[];
  /** Optional override for the policy limit. */
  limit?: number;
  /** Optional override for the policy window. */
  windowMs?: number;
}

/**
 * Attach an explicit rate-limit policy to a handler or controller.
 *
 * The default resolver already covers the product matrix; the decorator exists
 * for routes whose identity key or limit differs from the method + path rules.
 */
export const RateLimit = (options: RateLimitOptions = {}) =>
  SetMetadata(RATE_LIMIT_KEY, options);

/** Exempt a route from rate limiting. Reserved for health checks and assets. */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

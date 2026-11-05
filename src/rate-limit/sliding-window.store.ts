/** Result of one sliding-window hit. */
export interface SlidingWindowResult {
  allowed: boolean;
  /** Configured limit for the window. */
  limit: number;
  /** Requests counted in the window after this hit. */
  used: number;
  /** `limit - used`, never negative. */
  remaining: number;
  /** Epoch millis at which at least one slot frees up. */
  resetAt: number;
}

/**
 * Sliding-window counter store.
 *
 * `hit` returns `null` only when the backing store is unavailable (for
 * example a Redis outage); callers then fall back to the in-memory store.
 */
export interface SlidingWindowStore {
  hit(
    key: string,
    limit: number,
    windowMs: number,
    now?: number,
  ): Promise<SlidingWindowResult | null>;
}

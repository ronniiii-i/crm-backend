import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type {
  SlidingWindowResult,
  SlidingWindowStore,
} from './sliding-window.store';

interface Bucket {
  timestamps: number[];
  windowMs: number;
}

/**
 * Single-instance sliding-window store.
 *
 * Used directly when Redis is unavailable. Correct for one process; a
 * multi-instance deployment must use the Redis store so each instance sees
 * the same counters.
 */
@Injectable()
export class MemorySlidingWindowStore
  implements SlidingWindowStore, OnModuleDestroy
{
  /** Upper bound on tracked keys; the oldest bucket is evicted first. */
  static readonly MAX_KEYS = 50_000;

  private readonly buckets = new Map<string, Bucket>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    // Do not keep the process alive during tests or graceful shutdown.
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
    this.buckets.clear();
  }

  hit(
    key: string,
    limit: number,
    windowMs: number,
    now: number = Date.now(),
  ): Promise<SlidingWindowResult> {
    const cutoff = now - windowMs;
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { timestamps: [], windowMs };
      this.buckets.set(key, bucket);
      this.enforceKeyCap();
    } else {
      bucket.windowMs = windowMs;
      bucket.timestamps = prune(bucket.timestamps, cutoff);
    }

    const usedBefore = bucket.timestamps.length;
    const allowed = usedBefore < limit;

    if (allowed) {
      bucket.timestamps.push(now);
    }

    const used = bucket.timestamps.length;
    const oldest = bucket.timestamps[0] ?? now;
    const resetAt = oldest + windowMs;

    if (used === 0) {
      this.buckets.delete(key);
    }

    return Promise.resolve({
      allowed,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      resetAt,
    });
  }

  /** Test/ops hook: current number of tracked buckets. */
  get size(): number {
    return this.buckets.size;
  }

  private enforceKeyCap(): void {
    while (this.buckets.size > MemorySlidingWindowStore.MAX_KEYS) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      const cutoff = now - bucket.windowMs;
      bucket.timestamps = prune(bucket.timestamps, cutoff);
      if (bucket.timestamps.length === 0) this.buckets.delete(key);
    }
  }
}

/**
 * Drop every timestamp at or before `cutoff`.
 *
 * Timestamps are appended in order, so the first index newer than the cutoff
 * is found with a binary search instead of filtering the whole array.
 */
function prune(timestamps: number[], cutoff: number): number[] {
  if (timestamps.length === 0) return timestamps;

  let low = 0;
  let high = timestamps.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (timestamps[mid] <= cutoff) low = mid + 1;
    else high = mid;
  }

  return low === 0 ? timestamps : timestamps.slice(low);
}

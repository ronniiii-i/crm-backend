import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { buildRedisConfig, buildRedisUrl } from '../cache/redis.config';
import type {
  SlidingWindowResult,
  SlidingWindowStore,
} from './sliding-window.store';

/**
 * Minimal Redis surface needed for an atomic sliding window. The `redis`
 * package types differ between minor versions, so the client is modelled
 * locally and cast at the factory boundary.
 */
export type RateLimitRedisClient = {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  connect(): Promise<unknown>;
  quit(): Promise<string>;
  on(event: string, listener: (...args: any[]) => void): unknown;
};

export type RateLimitRedisClientFactory = (url: string) => RateLimitRedisClient;

export const RATE_LIMIT_REDIS_CLIENT_FACTORY =
  'RATE_LIMIT_REDIS_CLIENT_FACTORY';

export const defaultRateLimitRedisClientFactory: RateLimitRedisClientFactory = (
  url: string,
) =>
  createClient({
    url,
    socket: {
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT ?? 3000),
      reconnectStrategy: false,
    },
  }) as unknown as RateLimitRedisClient;

/**
 * Atomic sliding-window increment.
 *
 * Copied from Phase 4 Section 5.1.4. The member is unique per request so two
 * hits in the same millisecond both count.
 */
export const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, count + 1}
end
return {0, count}
`;

/**
 * Redis-backed sliding-window store.
 *
 * If Redis cannot be reached, `hit` returns `null` and the service uses the
 * in-memory store for that request. A rate limit must never turn a Redis
 * outage into a 500.
 */
@Injectable()
export class RedisSlidingWindowStore
  implements SlidingWindowStore, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RedisSlidingWindowStore.name);
  private readonly keyPrefix = buildRedisConfig().keyPrefix;
  private client?: RateLimitRedisClient;
  private connected = false;
  private lastErrorLogAt = 0;

  constructor(
    @Optional()
    @Inject(RATE_LIMIT_REDIS_CLIENT_FACTORY)
    private readonly clientFactory: RateLimitRedisClientFactory = defaultRateLimitRedisClientFactory,
  ) {}

  get ready(): boolean {
    return this.connected && !!this.client;
  }

  async onModuleInit(): Promise<void> {
    const config = buildRedisConfig();
    try {
      const client = this.clientFactory(buildRedisUrl(config));
      client.on('error', (error: unknown) => {
        this.connected = false;
        this.logRedisFailure(error);
      });
      client.on('ready', () => {
        this.connected = true;
      });

      await client.connect();
      this.client = client;
      this.connected = true;
      this.logger.log(
        `Rate-limit Redis connected (${config.host}:${config.port})`,
      );
    } catch (error) {
      this.connected = false;
      this.logger.warn(
        `Rate-limit Redis unavailable, using the in-memory store: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      // Ignore shutdown races.
    }
    this.client = undefined;
    this.connected = false;
  }

  async hit(
    key: string,
    limit: number,
    windowMs: number,
    now: number = Date.now(),
  ): Promise<SlidingWindowResult | null> {
    if (!this.ready || !this.client) return null;

    try {
      const raw = await this.client.eval(SLIDING_WINDOW_SCRIPT, {
        keys: [`${this.keyPrefix}:rate-limit:${key}`],
        arguments: [String(now), String(windowMs), String(limit), randomUUID()],
      });

      const values = Array.isArray(raw) ? raw : [];
      const allowed = Number(values[0] ?? 0) === 1;
      const used = Number(values[1] ?? 0);

      return {
        allowed,
        limit,
        used,
        remaining: Math.max(0, limit - used),
        // A sliding window does not have a fixed reset instant. The window
        // length is a safe, conservative value for the header.
        resetAt: now + windowMs,
      };
    } catch (error) {
      this.connected = false;
      this.logRedisFailure(error);
      return null;
    }
  }

  private logRedisFailure(error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLogAt < 60_000) return;
    this.lastErrorLogAt = now;
    this.logger.warn(
      `Rate-limit Redis error, falling back to memory: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createClient } from 'redis';
import { getTenantId } from '../tenant/tenant-context';
import { buildRedisConfig, buildRedisUrl } from './redis.config';

/**
 * Minimal surface of the Redis client used by this service. Declaring it
 * locally avoids coupling the code to the exact generic parameters of the
 * `redis` package (which differ between major versions).
 */
type RedisLike = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { EX?: number },
  ): Promise<string | null>;
  del(keys: string | string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  quit(): Promise<string>;
  connect(): Promise<unknown>;
  on(event: string, listener: (...args: any[]) => void): unknown;
};

/**
 * Factory used to build the Redis client. Injectable so tests can supply an
 * in-memory double instead of requiring a live Redis server.
 */
export type RedisClientFactory = (url: string) => RedisLike;

/**
 * In-memory Redis double used by the test suites. It implements the subset of
 * the Redis API the cache relies on, including glob-style `keys` matching.
 */
export class InMemoryRedisClient implements RedisLike {
  private readonly store = new Map<string, string>();
  private readonly listeners = new Map<string, Array<(...a: any[]) => void>>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(
      this.store.has(key) ? (this.store.get(key) as string) : null,
    );
  }

  set(key: string, value: string): Promise<string | null> {
    this.store.set(key, value);
    return Promise.resolve('OK');
  }

  del(keys: string | string[]): Promise<number> {
    const list = Array.isArray(keys) ? keys : [keys];
    let removed = 0;
    for (const key of list) {
      if (this.store.delete(key)) removed += 1;
    }
    return Promise.resolve(removed);
  }

  keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')}$`,
    );
    return Promise.resolve(
      Array.from(this.store.keys()).filter((key) => regex.test(key)),
    );
  }

  quit(): Promise<string> {
    this.store.clear();
    return Promise.resolve('OK');
  }

  connect(): Promise<unknown> {
    this.emit('ready');
    return Promise.resolve(undefined);
  }

  on(event: string, listener: (...args: any[]) => void): unknown {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  private emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

/**
 * Tenant-scoped cache backed by Redis.
 *
 * Multi-tenancy rules for cache keys:
 *
 *  * Every key is prefixed with `tenant:{tenantId}:` so two tenants can
 *    never read each other's entries, even when they use the same user id or
 *    route path.
 *  * When no tenant context is active (bootstrap, background jobs) the
 *    `global` pseudo-tenant is used. That namespace is deliberately distinct
 *    from any real tenant uuid.
 *  * The Redis connection is shared across application instances, so a
 *    multi-instance deployment behaves identically to a single instance.
 *
 * If Redis is unreachable the service degrades to a no-op cache rather than
 * failing the request: caching is an optimisation, never a source of truth.
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: RedisLike | undefined;
  private connected = false;
  private readonly keyPrefix: string;

  constructor(
    private readonly clientFactory: RedisClientFactory = (url: string) =>
      createClient({
        url,
        // Fail fast instead of hanging the boot when Redis is unreachable.
        socket: {
          connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT ?? 3000),
          reconnectStrategy: false,
        },
      }) as unknown as RedisLike,
  ) {
    this.keyPrefix = buildRedisConfig().keyPrefix;
  }

  async onModuleInit(): Promise<void> {
    const config = buildRedisConfig();
    const url = buildRedisUrl(config);

    try {
      const client = this.clientFactory(url);

      client.on('error', (error: unknown) => {
        this.connected = false;
        this.logger.warn(
          `Redis cache unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });

      client.on('ready', () => {
        this.connected = true;
      });

      await client.connect();
      this.client = client;
      this.connected = true;
      this.logger.log(`Redis cache connected (${config.host}:${config.port})`);
    } catch (error) {
      this.connected = false;
      this.logger.warn(
        `Redis cache could not be reached, continuing without cache: ${
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
      // Ignore shutdown races - the connection is being discarded anyway.
    }
    this.client = undefined;
    this.connected = false;
  }

  /**
   * Build a tenant-scoped cache key: `tenant:{tenantId}:{key}`.
   * When no tenant context is active (e.g. background jobs, bootstrap),
   * the `global` pseudo-tenant is used so keys remain deterministic and
   * never collide with a real tenant namespace.
   */
  tenantKey(key: string, tenantId: string = getTenantId() ?? 'global'): string {
    return `tenant:${tenantId}:${key}`;
  }

  private fullKey(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    if (!this.connected || !this.client) return undefined;
    try {
      const raw = await this.client.get(this.fullKey(key));
      if (raw === null || raw === undefined) return undefined;
      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.warn(
        `Cache read failed for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<boolean> {
    if (!this.connected || !this.client) return false;
    try {
      const serialized = JSON.stringify(value ?? null);
      if (ttl && ttl > 0) {
        await this.client.set(this.fullKey(key), serialized, { EX: ttl });
      } else {
        await this.client.set(this.fullKey(key), serialized);
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `Cache write failed for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  async del(key: string): Promise<number> {
    if (!this.connected || !this.client) return 0;
    try {
      const removed = await this.client.del(this.fullKey(key));
      return removed;
    } catch {
      return 0;
    }
  }

  async flush(): Promise<void> {
    if (!this.connected || !this.client) return;
    try {
      const keys = await this.client.keys(this.fullKey('*'));
      if (keys.length > 0) await this.client.del(keys);
    } catch {
      // Ignore - flushing is best effort.
    }
  }

  // Call this when routes change
  async invalidateRouteCache(path: string): Promise<void> {
    await this.del(this.tenantKey(`route:${path}`));
  }

  // Call this when all routes need refreshing
  async invalidateAllRoutes(): Promise<void> {
    if (!this.connected || !this.client) return;
    try {
      const keys = await this.client.keys(this.fullKey('tenant:*:route:*'));
      if (keys.length > 0) await this.client.del(keys);
    } catch {
      // Ignore - invalidation is best effort.
    }
  }

  /** Drop every cache entry belonging to a tenant (e.g. on tenant purge). */
  async flushTenant(
    tenantId: string = getTenantId() ?? 'global',
  ): Promise<void> {
    if (!this.connected || !this.client) return;
    try {
      const keys = await this.client.keys(this.fullKey(`tenant:${tenantId}:*`));
      if (keys.length > 0) await this.client.del(keys);
    } catch {
      // Ignore - invalidation is best effort.
    }
  }

  /** Remove every cache entry for a specific user inside the tenant. */
  async invalidateUser(userId: string, tenantId?: string): Promise<void> {
    const resolved = tenantId ?? getTenantId() ?? 'global';
    if (!this.connected || !this.client) return;
    try {
      const keys = await this.client.keys(
        this.fullKey(`tenant:${resolved}:user:${userId}:*`),
      );
      if (keys.length > 0) await this.client.del(keys);
    } catch {
      // Ignore - invalidation is best effort.
    }
  }

  getStats(): {
    connected: boolean;
    keyPrefix: string;
  } {
    return {
      connected: this.connected,
      keyPrefix: this.keyPrefix,
    };
  }
}

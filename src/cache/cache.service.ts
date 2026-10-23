import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
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
 * Injection token for {@link RedisClientFactory}.
 *
 * A function type cannot be resolved by Nest's injector on its own, so it is
 * exposed under an explicit token. The dependency is optional: when the token
 * is not provided the service falls back to the default `redis` client.
 */
export const REDIS_CLIENT_FACTORY = 'REDIS_CLIENT_FACTORY';

/** Default factory: a real `redis` client pointed at the configured server. */
export const defaultRedisClientFactory: RedisClientFactory = (url: string) =>
  createClient({
    url,
    // Fail fast instead of hanging the boot when Redis is unreachable.
    socket: {
      connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT ?? 3000),
      reconnectStrategy: false,
    },
  }) as unknown as RedisLike;

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
    const regex = globToRegExp(pattern);
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

/** Translate a Redis glob pattern (`*`, `?`) into an anchored RegExp. */
function globToRegExp(pattern: string): RegExp {
  return new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
  );
}

interface MemoryEntry {
  value: string;
  /** Epoch millis at which the entry expires. */
  expiresAt: number;
}

/**
 * Tenant-scoped cache backed by Redis, with a bounded in-process fallback.
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
 * Availability:
 *
 *  * If Redis is unreachable the service degrades to a bounded in-process
 *    cache instead of a no-op. This keeps single-node deployments fast (the
 *    database is often hundreds of milliseconds away) at the cost of
 *    cross-instance invalidation.
 *  * In-process entries are capped at {@link MEMORY_TTL_CAP_MS} so a
 *    permission change is observed within a minute even when no other
 *    instance can invalidate this one. Set `REDIS_FALLBACK_MEMORY=false` to
 *    disable the fallback entirely.
 *  * Caching is always an optimisation, never a source of truth; every
 *    failure path falls through to the database.
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  /** Never serve an in-process entry for longer than this. */
  private static readonly MEMORY_TTL_CAP_MS = 60_000;
  /** Upper bound on in-process entries to keep memory usage predictable. */
  private static readonly MEMORY_MAX_ENTRIES = 1_000;

  private readonly logger = new Logger(CacheService.name);
  private client: RedisLike | undefined;
  private connected = false;
  private readonly keyPrefix: string;
  private readonly clientFactory: RedisClientFactory;
  private readonly memoryFallback: boolean;
  private readonly memory = new Map<string, MemoryEntry>();

  constructor(
    @Optional()
    @Inject(REDIS_CLIENT_FACTORY)
    clientFactory?: RedisClientFactory,
  ) {
    this.clientFactory = clientFactory ?? defaultRedisClientFactory;
    this.keyPrefix = buildRedisConfig().keyPrefix;
    this.memoryFallback =
      (process.env.REDIS_FALLBACK_MEMORY ?? 'true').toLowerCase() !== 'false';
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
        `Redis cache could not be reached, continuing with the in-process fallback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.memory.clear();
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

  private get redisReady(): boolean {
    return this.connected && !!this.client;
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    if (this.redisReady) {
      try {
        const raw = await this.client!.get(this.fullKey(key));
        if (raw !== null && raw !== undefined) return JSON.parse(raw) as T;
      } catch (error) {
        this.logger.warn(
          `Cache read failed for ${key}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (!this.memoryFallback) return undefined;

    const entry = this.memory.get(this.fullKey(key));
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(this.fullKey(key));
      return undefined;
    }
    try {
      return JSON.parse(entry.value) as T;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<boolean> {
    const serialized = JSON.stringify(value ?? null);
    let stored = false;

    if (this.redisReady) {
      try {
        if (ttl && ttl > 0) {
          await this.client!.set(this.fullKey(key), serialized, { EX: ttl });
        } else {
          await this.client!.set(this.fullKey(key), serialized);
        }
        stored = true;
      } catch (error) {
        this.logger.warn(
          `Cache write failed for ${key}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (this.memoryFallback) {
      this.setMemory(key, serialized, ttl);
      stored = true;
    }

    return stored;
  }

  private setMemory(key: string, serialized: string, ttl?: number): void {
    const ttlMs = Math.min(
      ttl && ttl > 0 ? ttl * 1000 : CacheService.MEMORY_TTL_CAP_MS,
      CacheService.MEMORY_TTL_CAP_MS,
    );
    const fullKey = this.fullKey(key);

    // Refresh insertion order so the eviction below is LRU-ish.
    this.memory.delete(fullKey);
    this.memory.set(fullKey, {
      value: serialized,
      expiresAt: Date.now() + ttlMs,
    });

    if (this.memory.size > CacheService.MEMORY_MAX_ENTRIES) {
      const oldest = this.memory.keys().next().value;
      if (oldest !== undefined) this.memory.delete(oldest);
    }
  }

  async del(key: string): Promise<number> {
    let removed = 0;
    if (this.redisReady) {
      try {
        removed = await this.client!.del(this.fullKey(key));
      } catch {
        removed = 0;
      }
    }
    if (this.memory.delete(this.fullKey(key))) removed += 1;
    return removed;
  }

  /** Remove every in-process key matching a Redis glob pattern. */
  private deleteMemoryByPattern(pattern: string): number {
    const regex = globToRegExp(this.fullKey(pattern));
    let removed = 0;
    for (const key of Array.from(this.memory.keys())) {
      if (regex.test(key)) {
        this.memory.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  private async deleteRedisByPattern(pattern: string): Promise<void> {
    if (!this.redisReady) return;
    try {
      const keys = await this.client!.keys(this.fullKey(pattern));
      if (keys.length > 0) await this.client!.del(keys);
    } catch {
      // Ignore - invalidation is best effort.
    }
  }

  async flush(): Promise<void> {
    this.memory.clear();
    await this.deleteRedisByPattern('*');
  }

  // Call this when routes change
  async invalidateRouteCache(path: string): Promise<void> {
    await this.del(this.tenantKey(`route:${path}`));
  }

  // Call this when all routes need refreshing
  async invalidateAllRoutes(): Promise<void> {
    this.deleteMemoryByPattern('tenant:*:route:*');
    await this.deleteRedisByPattern('tenant:*:route:*');
  }

  /** Drop every cache entry belonging to a tenant (e.g. on tenant purge). */
  async flushTenant(
    tenantId: string = getTenantId() ?? 'global',
  ): Promise<void> {
    this.deleteMemoryByPattern(`tenant:${tenantId}:*`);
    await this.deleteRedisByPattern(`tenant:${tenantId}:*`);
  }

  /** Remove every cache entry for a specific user inside the tenant. */
  async invalidateUser(userId: string, tenantId?: string): Promise<void> {
    const resolved = tenantId ?? getTenantId() ?? 'global';
    this.deleteMemoryByPattern(`tenant:${resolved}:user:${userId}:*`);
    await this.deleteRedisByPattern(`tenant:${resolved}:user:${userId}:*`);
  }

  getStats(): {
    connected: boolean;
    backend: 'redis' | 'memory' | 'none';
    keyPrefix: string;
    memoryEntries: number;
  } {
    return {
      connected: this.connected,
      backend: this.redisReady
        ? 'redis'
        : this.memoryFallback
          ? 'memory'
          : 'none',
      keyPrefix: this.keyPrefix,
      memoryEntries: this.memory.size,
    };
  }
}

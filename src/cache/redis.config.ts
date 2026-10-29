/**
 * Redis connection configuration.
 *
 * The cache must be shared across application instances, so the in-process
 * `node-cache` store was replaced with a real Redis connection. Everything is
 * env-driven (no hardcoded host/port) so the same image can be pointed at a
 * managed Redis instance in production.
 */

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  /** Use TLS when connecting to a managed provider (e.g. Upstash). */
  tls: boolean;
  /** Database index. */
  db: number;
  /** Key prefix so several apps can share one Redis instance. */
  keyPrefix: string;
}

export const DEFAULT_REDIS_CONFIG: RedisConfig = {
  host: 'localhost',
  port: 6379,
  password: undefined,
  tls: false,
  db: 0,
  keyPrefix: 'claspworkspace',
};

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function buildRedisConfig(
  env: NodeJS.ProcessEnv = process.env,
): RedisConfig {
  const port = Number(env.REDIS_PORT ?? DEFAULT_REDIS_CONFIG.port);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `Invalid REDIS_PORT "${env.REDIS_PORT}" - expected an integer between 1 and 65535`,
    );
  }

  const db = Number(env.REDIS_DB ?? DEFAULT_REDIS_CONFIG.db);

  if (!Number.isInteger(db) || db < 0) {
    throw new Error(
      `Invalid REDIS_DB "${env.REDIS_DB}" - expected a non-negative integer`,
    );
  }

  return {
    host: env.REDIS_HOST || DEFAULT_REDIS_CONFIG.host,
    port,
    password: env.REDIS_PASSWORD || undefined,
    tls: toBool(env.REDIS_TLS, DEFAULT_REDIS_CONFIG.tls),
    db,
    keyPrefix: env.REDIS_KEY_PREFIX || DEFAULT_REDIS_CONFIG.keyPrefix,
  };
}

/**
 * Builds the connection URL for the `redis` client.
 *
 * `rediss://` is used when TLS is enabled so managed providers that only
 * accept TLS URLs still work.
 */
export function buildRedisUrl(config: RedisConfig): string {
  const protocol = config.tls ? 'rediss' : 'redis';
  const auth = config.password
    ? `:${encodeURIComponent(config.password)}@`
    : '';
  return `${protocol}://${auth}${config.host}:${config.port}/${config.db}`;
}

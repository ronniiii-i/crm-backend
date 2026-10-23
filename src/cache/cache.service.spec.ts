import { Test, TestingModule } from '@nestjs/testing';
import {
  CacheService,
  InMemoryRedisClient,
  REDIS_CLIENT_FACTORY,
} from './cache.service';
import { buildRedisConfig, buildRedisUrl } from './redis.config';

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: REDIS_CLIENT_FACTORY,
          useValue: () => new InMemoryRedisClient(),
        },
        CacheService,
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('tenant key scoping', () => {
    it('prefixes every key with the tenant id', () => {
      expect(service.tenantKey('user:1:modules', 'tenant-a')).toBe(
        'tenant:tenant-a:user:1:modules',
      );
    });

    it('uses a distinct pseudo-tenant when no tenant context is active', () => {
      const key = service.tenantKey('user:1:modules');
      expect(key).toBe('tenant:global:user:1:modules');
    });

    it('never produces the same key for two different tenants', () => {
      const a = service.tenantKey('user:1:modules', 'tenant-a');
      const b = service.tenantKey('user:1:modules', 'tenant-b');
      expect(a).not.toBe(b);
    });
  });

  describe('redis configuration', () => {
    it('is env-driven and never hardcoded', () => {
      const config = buildRedisConfig({
        REDIS_HOST: 'cache.internal',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: 's3cret',
        REDIS_TLS: 'true',
        REDIS_DB: '2',
      } as NodeJS.ProcessEnv);

      expect(config.host).toBe('cache.internal');
      expect(config.port).toBe(6380);
      expect(config.password).toBe('s3cret');
      expect(config.tls).toBe(true);
      expect(config.db).toBe(2);
    });

    it('builds a rediss:// url when TLS is enabled', () => {
      const config = buildRedisConfig({
        REDIS_HOST: 'cache.internal',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: 'p@ss word',
        REDIS_TLS: 'true',
      } as NodeJS.ProcessEnv);

      expect(buildRedisUrl(config)).toBe(
        'rediss://:p%40ss%20word@cache.internal:6380/0',
      );
    });

    it('rejects an invalid port', () => {
      expect(() =>
        buildRedisConfig({ REDIS_PORT: 'not-a-port' } as NodeJS.ProcessEnv),
      ).toThrow(/Invalid REDIS_PORT/);
    });

    it('rejects a negative database index', () => {
      expect(() =>
        buildRedisConfig({ REDIS_DB: '-1' } as NodeJS.ProcessEnv),
      ).toThrow(/Invalid REDIS_DB/);
    });
  });

  describe('read / write', () => {
    it('stores and retrieves a JSON value', async () => {
      const key = service.tenantKey('user:1:modules', 'tenant-a');

      await expect(service.set(key, { modules: ['contacts'] })).resolves.toBe(
        true,
      );
      await expect(service.get(key)).resolves.toEqual({
        modules: ['contacts'],
      });
    });

    it('returns undefined for a missing key', async () => {
      await expect(
        service.get('tenant:global:missing'),
      ).resolves.toBeUndefined();
    });

    it('deletes an entry', async () => {
      const key = service.tenantKey('user:1:modules', 'tenant-a');
      await service.set(key, { a: 1 });

      await expect(service.del(key)).resolves.toBe(1);
      await expect(service.get(key)).resolves.toBeUndefined();
    });
  });

  describe('tenant isolation', () => {
    it('never returns a tenant A entry for tenant B', async () => {
      const keyA = service.tenantKey('user:1:modules', 'tenant-a');
      const keyB = service.tenantKey('user:1:modules', 'tenant-b');

      await service.set(keyA, { modules: ['contacts'] });

      await expect(service.get(keyB)).resolves.toBeUndefined();
    });

    it('invalidates only the requested tenant', async () => {
      const keyA = service.tenantKey('user:1:modules', 'tenant-a');
      const keyB = service.tenantKey('user:1:modules', 'tenant-b');

      await service.set(keyA, { modules: ['contacts'] });
      await service.set(keyB, { modules: ['deals'] });

      await service.flushTenant('tenant-a');

      await expect(service.get(keyA)).resolves.toBeUndefined();
      await expect(service.get(keyB)).resolves.toEqual({
        modules: ['deals'],
      });
    });

    it('invalidates only the requested user', async () => {
      const keyOne = service.tenantKey('user:user-1:modules', 'tenant-a');
      const keyTwo = service.tenantKey('user:user-2:modules', 'tenant-a');

      await service.set(keyOne, { a: 1 });
      await service.set(keyTwo, { b: 2 });

      await service.invalidateUser('user-1', 'tenant-a');

      await expect(service.get(keyOne)).resolves.toBeUndefined();
      await expect(service.get(keyTwo)).resolves.toEqual({ b: 2 });
    });
  });

  describe('graceful degradation', () => {
    it('reports no cache hit for a key that was never written', async () => {
      const unreachable = new CacheService(() => {
        throw new Error('redis unreachable');
      });

      await unreachable.onModuleInit();

      await expect(
        unreachable.get('tenant:global:missing'),
      ).resolves.toBeUndefined();
      expect(unreachable.getStats().connected).toBe(false);
      expect(unreachable.getStats().backend).toBe('memory');

      await unreachable.onModuleDestroy();
    });

    it('falls back to the in-process cache when redis is down', async () => {
      const degraded = new CacheService(() => {
        throw new Error('redis unreachable');
      });
      await degraded.onModuleInit();

      const key = degraded.tenantKey('user:1:modules', 'tenant-a');

      await expect(degraded.set(key, { modules: ['deals'] })).resolves.toBe(
        true,
      );
      await expect(degraded.get(key)).resolves.toEqual({ modules: ['deals'] });

      // In-process invalidation still works.
      await degraded.invalidateUser('user-1', 'tenant-a');
      await degraded.flushTenant('tenant-a');
      await expect(degraded.get(key)).resolves.toBeUndefined();

      await degraded.onModuleDestroy();
    });

    it('can disable the fallback entirely', async () => {
      const previous = process.env.REDIS_FALLBACK_MEMORY;
      process.env.REDIS_FALLBACK_MEMORY = 'false';
      try {
        const noop = new CacheService(() => {
          throw new Error('redis unreachable');
        });
        await noop.onModuleInit();

        await expect(noop.set('tenant:global:key', { a: 1 }, 60)).resolves.toBe(
          false,
        );
        await expect(noop.get('tenant:global:key')).resolves.toBeUndefined();
        expect(noop.getStats().backend).toBe('none');

        await noop.onModuleDestroy();
      } finally {
        if (previous === undefined) delete process.env.REDIS_FALLBACK_MEMORY;
        else process.env.REDIS_FALLBACK_MEMORY = previous;
      }
    });

    it('does not throw when invalidating without a redis connection', async () => {
      await expect(
        service.invalidateUser('user-1', 'tenant-a'),
      ).resolves.toBeUndefined();
      await expect(service.invalidateAllRoutes()).resolves.toBeUndefined();
      await expect(service.flushTenant('tenant-a')).resolves.toBeUndefined();
    });
  });
});

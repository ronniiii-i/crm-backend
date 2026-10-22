import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from './cache.service';
import { buildRedisConfig, buildRedisUrl } from './redis.config';

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CacheService],
    }).compile();

    service = module.get<CacheService>(CacheService);
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

  describe('graceful degradation', () => {
    it('reports no cache hit when redis is unreachable', async () => {
      // The client was never connected in the test environment.
      await expect(
        service.get('tenant:global:missing'),
      ).resolves.toBeUndefined();
    });

    it('does not throw when writing without a redis connection', async () => {
      await expect(
        service.set('tenant:global:key', { a: 1 }, 60),
      ).resolves.toBe(false);
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

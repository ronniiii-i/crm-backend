import { MemorySlidingWindowStore } from './memory-sliding-window.store';
import { RateLimitService } from './rate-limit.service';

function withEnv(
  key: string,
  value: string,
  run: () => Promise<void> | void,
): Promise<void> {
  const previous = process.env[key];
  process.env[key] = value;
  return Promise.resolve(run()).finally(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

describe('RateLimitService', () => {
  let memory: MemorySlidingWindowStore;

  beforeEach(() => {
    memory = new MemorySlidingWindowStore();
  });

  afterEach(() => {
    memory.onModuleDestroy();
  });

  it('allows 15 credential attempts and rejects the 16th in one minute', async () => {
    await withEnv('RATE_LIMIT_AUTH_PER_MIN', '15', async () => {
      const service = new RateLimitService(memory);
      const now = 1_000_000;

      for (let index = 0; index < 15; index += 1) {
        const result = await service.consume(
          'auth-credential',
          '203.0.113.5|acme|/auth/login',
          undefined,
          now + index,
        );
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(14 - index);
      }

      const blocked = await service.consume(
        'auth-credential',
        '203.0.113.5|acme|/auth/login',
        undefined,
        now + 16,
      );

      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.resetAt).toBeGreaterThan(now);
    });
  });

  it('frees a slot once the window has rolled past it', async () => {
    await withEnv('RATE_LIMIT_AUTH_PER_MIN', '2', async () => {
      const service = new RateLimitService(memory);
      const now = 5_000_000;

      await service.consume('auth-credential', 'key', undefined, now);
      await service.consume('auth-credential', 'key', undefined, now + 10);

      const blocked = await service.consume(
        'auth-credential',
        'key',
        undefined,
        now + 20,
      );
      expect(blocked.allowed).toBe(false);

      const afterWindow = await service.consume(
        'auth-credential',
        'key',
        undefined,
        now + 60_005,
      );
      expect(afterWindow.allowed).toBe(true);
    });
  });

  it('uses 600 reads per minute by default', async () => {
    const service = new RateLimitService(memory);
    const result = await service.consume('api-read', 'user-1');
    expect(result.limit).toBe(600);
  });

  it('falls back to the in-memory store when Redis returns null', async () => {
    const redis = {
      ready: true,
      hit: jest.fn().mockResolvedValue(null),
    };
    const service = new RateLimitService(memory, redis as any);

    const result = await service.consume('api-read', 'user-1');

    expect(redis.hit).toHaveBeenCalled();
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(600);
  });

  it('shares a bucket only when the policy and identity key match', async () => {
    await withEnv('RATE_LIMIT_API_PER_MIN', '1', async () => {
      const service = new RateLimitService(memory);
      const now = 9_000_000;

      expect(
        (await service.consume('api-read', 'user-a', undefined, now)).allowed,
      ).toBe(true);
      expect(
        (await service.consume('api-read', 'user-a', undefined, now)).allowed,
      ).toBe(false);
      expect(
        (await service.consume('api-read', 'user-b', undefined, now)).allowed,
      ).toBe(true);
    });
  });
});

import { HttpException } from '@nestjs/common';
import { MemorySlidingWindowStore } from './memory-sliding-window.store';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';

interface FakeRequest {
  method: string;
  path: string;
  ip: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  socket: { remoteAddress: string };
}

function createContext(overrides: Partial<FakeRequest> = {}): {
  context: any;
  request: FakeRequest;
  response: { setHeader: jest.Mock };
} {
  const request: FakeRequest = {
    method: 'GET',
    path: '/workspace/contacts',
    ip: '203.0.113.9',
    headers: {},
    body: {},
    socket: { remoteAddress: '203.0.113.9' },
    ...overrides,
  };
  const response = { setHeader: jest.fn() };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  };
  return { context: context as any, request, response };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function createGuard(
  memory: MemorySlidingWindowStore,
  verify: (token: string) => Promise<any>,
): RateLimitGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(undefined),
  } as any;
  const jwt = { verifyAsync: jest.fn(verify) } as any;
  return new RateLimitGuard(reflector, new RateLimitService(memory), jwt);
}

function rateLimitedBody(error: unknown): any {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse();
}

describe('RateLimitGuard', () => {
  let memory: MemorySlidingWindowStore;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    memory = new MemorySlidingWindowStore();
    savedEnv.RATE_LIMIT_AUTH_PER_MIN = process.env.RATE_LIMIT_AUTH_PER_MIN;
    savedEnv.RATE_LIMIT_API_PER_MIN = process.env.RATE_LIMIT_API_PER_MIN;
    savedEnv.RATE_LIMIT_ENFORCE = process.env.RATE_LIMIT_ENFORCE;
    process.env.RATE_LIMIT_ENFORCE = 'true';
  });

  afterEach(() => {
    memory.onModuleDestroy();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('rejects the 16th login from one IP with Retry-After and the standard body', async () => {
    process.env.RATE_LIMIT_AUTH_PER_MIN = '15';
    const guard = createGuard(memory, async () => {
      throw new Error('no token expected');
    });

    for (let index = 0; index < 15; index += 1) {
      const { context } = createContext({
        method: 'POST',
        path: '/auth/login',
        body: { email: `user${index}@example.com` },
      });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }

    const { context, response } = createContext({
      method: 'POST',
      path: '/auth/login',
      body: { email: 'user-16@example.com' },
    });

    let caught: unknown;
    try {
      await guard.canActivate(context);
    } catch (error) {
      caught = error;
    }

    const body = rateLimitedBody(caught);
    expect(body).toEqual({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests. Try again shortly.',
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      'RateLimit-Limit',
      expect.any(String),
    );
    expect(response.setHeader).toHaveBeenCalledWith('RateLimit-Remaining', '0');
    expect(response.setHeader).toHaveBeenCalledWith(
      'RateLimit-Reset',
      expect.any(String),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
  });

  it('gives two authenticated users independent read buckets on the same IP', async () => {
    process.env.RATE_LIMIT_API_PER_MIN = '2';
    const guard = createGuard(memory, async (token) => {
      const sub = token === 'token-a' ? 'user-a' : 'user-b';
      return { sub, tenantId: 'tenant-1', tenantSlug: 'acme' };
    });

    for (const token of ['token-a', 'token-a']) {
      const { context } = createContext({ headers: bearer(token) });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }

    const { context: aContext } = createContext({
      headers: bearer('token-a'),
    });
    await expect(guard.canActivate(aContext)).rejects.toBeInstanceOf(
      HttpException,
    );

    // The second user still has their full allowance on the same IP.
    for (const token of ['token-b', 'token-b']) {
      const { context } = createContext({ headers: bearer(token) });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
  });

  it('falls back to the IP bucket for an invalid token', async () => {
    process.env.RATE_LIMIT_API_PER_MIN = '2';
    const guard = createGuard(memory, async () => {
      throw new Error('invalid token');
    });

    for (const token of ['bogus-1', 'bogus-2']) {
      const { context } = createContext({ headers: bearer(token) });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }

    const { context } = createContext({ headers: bearer('bogus-3') });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('blocks the same email across different IPs with the account bucket', async () => {
    process.env.RATE_LIMIT_AUTH_PER_MIN = '100';
    const guard = createGuard(memory, async () => {
      throw new Error('no token expected');
    });

    for (let index = 0; index < 10; index += 1) {
      const { context } = createContext({
        method: 'POST',
        path: '/auth/login',
        ip: `198.51.100.${index + 1}`,
        socket: { remoteAddress: `198.51.100.${index + 1}` },
        body: { email: 'victim@example.com' },
      });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }

    const { context } = createContext({
      method: 'POST',
      path: '/auth/login',
      ip: '198.51.100.200',
      socket: { remoteAddress: '198.51.100.200' },
      body: { email: 'VICTIM@example.com' },
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});

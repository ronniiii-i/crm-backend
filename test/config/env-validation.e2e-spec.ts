// test/config/env-validation.e2e-spec.ts
//
// Production-readiness checks for the environment contract:
//   * the app refuses to boot with a missing required variable
//   * placeholder / weak JWT secrets are rejected
//   * a valid environment passes
//   * `requireEnv` fails fast instead of returning undefined

import { validateEnv } from '../../src/config/env.validation';
import { requireEnv, optionalEnv } from '../../src/config/env';

const VALID_ENV = {
  NODE_ENV: 'test',
  PORT: '3030',
  DATABASE_URL: 'postgresql://crm_app:pass@localhost:5432/crm',
  JWT_SECRET: 'a-very-long-and-unique-secret-value',
};

describe('env validation', () => {
  it('accepts a valid environment', () => {
    const env = validateEnv(VALID_ENV as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(3030);
    expect(env.DATABASE_URL).toContain('crm_app');
    expect(env.REDIS_HOST).toBe('localhost');
    expect(env.REDIS_PORT).toBe(6379);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, DATABASE_URL: undefined } as any),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects a missing JWT_SECRET', () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, JWT_SECRET: undefined } as any),
    ).toThrow(/JWT_SECRET/);
  });

  it('rejects a short JWT_SECRET', () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, JWT_SECRET: 'short' } as any),
    ).toThrow(/at least 16 characters/);
  });

  it('rejects the legacy "supersecret" fallback', () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, JWT_SECRET: 'supersecret' } as any),
    ).toThrow(/placeholder/);
  });

  it('rejects the documented placeholder secret', () => {
    expect(() =>
      validateEnv({
        ...VALID_ENV,
        JWT_SECRET: 'change-me-in-production',
      } as any),
    ).toThrow(/placeholder/);
  });

  it('reports every problem at once', () => {
    let message = '';
    try {
      validateEnv({} as any);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('JWT_SECRET');
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => validateEnv({ ...VALID_ENV, PORT: 'abc' } as any)).toThrow(
      /PORT/,
    );
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => validateEnv({ ...VALID_ENV, PORT: '-1' } as any)).toThrow(
      /PORT/,
    );
  });
});

describe('requireEnv', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterAll(() => {
    process.env = original;
  });

  it('returns the value when it is set', () => {
    process.env.SOME_TEST_VAR = 'value';
    expect(requireEnv('SOME_TEST_VAR')).toBe('value');
  });

  it('throws when the variable is missing', () => {
    delete process.env.SOME_MISSING_VAR;
    expect(() => requireEnv('SOME_MISSING_VAR')).toThrow(
      /Missing required environment variable/,
    );
  });

  it('throws when the variable is blank', () => {
    process.env.SOME_BLANK_VAR = '   ';
    expect(() => requireEnv('SOME_BLANK_VAR')).toThrow(
      /Missing required environment variable/,
    );
  });
});

describe('optionalEnv', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterAll(() => {
    process.env = original;
  });

  it('returns the value when it is set', () => {
    process.env.SOME_OPTIONAL_VAR = 'value';
    expect(optionalEnv('SOME_OPTIONAL_VAR', 'fallback')).toBe('value');
  });

  it('returns the fallback when it is missing', () => {
    delete process.env.SOME_OPTIONAL_VAR;
    expect(optionalEnv('SOME_OPTIONAL_VAR', 'fallback')).toBe('fallback');
  });
});

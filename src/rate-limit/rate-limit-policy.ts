/**
 * Identity-aware rate-limit policy catalogue and route resolver.
 *
 * The matrix mirrors Phase 4 Section 5.1.1. Limits are environment-driven so
 * the acceptance suite can raise the per-IP auth limit without weakening the
 * production defaults.
 */

export type RateLimitPolicyName =
  | 'auth-credential'
  | 'auth-credential-hour'
  | 'auth-login-account'
  | 'auth-session'
  | 'api-read'
  | 'api-write'
  | 'api-export'
  | 'search'
  | 'lookups'
  | 'sse-connect'
  | 'public-form'
  | 'system-admin';

export interface RateLimitPolicyDefinition {
  name: RateLimitPolicyName;
  limit: number;
  windowMs: number;
}

export interface RateLimitPolicyOverrides {
  limit?: number;
  windowMs?: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Runtime limits, read from the validated environment variables. */
export function buildPolicyDefinitions(
  env: NodeJS.ProcessEnv = process.env,
): Record<RateLimitPolicyName, RateLimitPolicyDefinition> {
  return {
    'auth-credential': {
      name: 'auth-credential',
      limit: positiveInt(env.RATE_LIMIT_AUTH_PER_MIN, 15),
      windowMs: MINUTE,
    },
    'auth-credential-hour': {
      name: 'auth-credential-hour',
      limit: positiveInt(env.RATE_LIMIT_AUTH_PER_HOUR, 60),
      windowMs: HOUR,
    },
    'auth-login-account': {
      name: 'auth-login-account',
      limit: 10,
      windowMs: 15 * MINUTE,
    },
    'auth-session': { name: 'auth-session', limit: 120, windowMs: MINUTE },
    'api-read': {
      name: 'api-read',
      limit: positiveInt(env.RATE_LIMIT_API_PER_MIN, 600),
      windowMs: MINUTE,
    },
    'api-write': {
      name: 'api-write',
      limit: positiveInt(env.RATE_LIMIT_WRITE_PER_MIN, 120),
      windowMs: MINUTE,
    },
    'api-export': {
      name: 'api-export',
      limit: positiveInt(env.RATE_LIMIT_EXPORT_PER_HOUR, 10),
      windowMs: HOUR,
    },
    search: { name: 'search', limit: 120, windowMs: MINUTE },
    lookups: { name: 'lookups', limit: 300, windowMs: MINUTE },
    'sse-connect': { name: 'sse-connect', limit: 10, windowMs: MINUTE },
    'public-form': { name: 'public-form', limit: 10, windowMs: MINUTE },
    'system-admin': { name: 'system-admin', limit: 300, windowMs: MINUTE },
  };
}

export function applyPolicyOverrides(
  definition: RateLimitPolicyDefinition,
  overrides?: RateLimitPolicyOverrides,
): RateLimitPolicyDefinition {
  if (!overrides) return definition;
  return {
    ...definition,
    limit: overrides.limit ?? definition.limit,
    windowMs: overrides.windowMs ?? definition.windowMs,
  };
}

const CREDENTIAL_ROUTES = new Set([
  '/auth/verify-email',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

const AUTH_SESSION_ROUTES = new Set([
  '/auth/refresh',
  '/auth/logout',
  '/auth/verify',
]);

const PUBLIC_FORM_ROUTES = new Set([
  '/public/contact',
  '/public/register',
  '/public/find-workspace',
]);

const AUTHENTICATED_PREFIXES = [
  '/workspace',
  '/departments',
  '/notifications',
  '/auth/acl',
  '/profile',
  '/users',
  '/roles',
  '/projects',
  '/dashboard',
  '/invitations',
  '/billing',
  '/tenant',
  '/access-control',
];

function isWriteMethod(method: string): boolean {
  return (
    method === 'POST' ||
    method === 'PATCH' ||
    method === 'PUT' ||
    method === 'DELETE'
  );
}

function startsWithAny(path: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Default policy stack for a route. `@RateLimit` metadata replaces this list.
 *
 * Login returns three buckets so the effective limit is the strictest of the
 * per-IP burst, the per-IP hourly cap and the per-account cap.
 */
export function resolvePolicyNames(
  method: string,
  path: string,
): RateLimitPolicyName[] {
  const httpMethod = method.toUpperCase();
  const route = path.split('?')[0] || '/';

  if (route === '/auth/login') {
    return ['auth-credential', 'auth-credential-hour', 'auth-login-account'];
  }

  if (CREDENTIAL_ROUTES.has(route)) {
    return ['auth-credential', 'auth-credential-hour'];
  }

  if (AUTH_SESSION_ROUTES.has(route)) {
    return ['auth-session'];
  }

  if (route.startsWith('/system-admin')) {
    return ['system-admin'];
  }

  if (PUBLIC_FORM_ROUTES.has(route)) {
    return ['public-form'];
  }

  if (route === '/workspace/search' || route.startsWith('/workspace/search/')) {
    return ['search'];
  }

  if (/^\/workspace\/modules\/[^/]+\/[^/]+\/lookups(?:\/|$)/.test(route)) {
    return ['lookups'];
  }

  if (/^\/workspace\/modules\/[^/]+\/[^/]+\/export\/?$/.test(route)) {
    return ['api-export'];
  }

  if (route === '/notifications/stream') {
    return ['sse-connect'];
  }

  if (startsWithAny(route, AUTHENTICATED_PREFIXES)) {
    return [isWriteMethod(httpMethod) ? 'api-write' : 'api-read'];
  }

  // Fail safe: every route gets a bucket even when it is not in the matrix.
  return [isWriteMethod(httpMethod) ? 'api-write' : 'api-read'];
}

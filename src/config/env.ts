/**
 * Reads a required environment variable, failing fast when it is missing.
 *
 * `main.ts` validates the whole environment with `validateEnv()` before the
 * Nest application is created, so by the time any module is instantiated the
 * variable is guaranteed to exist. This helper keeps that guarantee explicit
 * for the few places that need a value at module-evaluation time (e.g. the
 * JWT secret passed to `passport-jwt`).
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

/** Optional environment variable with a fallback. */
export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

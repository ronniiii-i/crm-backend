/**
 * Cache key for a revoked (logged-out) session token.
 *
 * Kept in its own module so both the auth service (writes on logout) and the
 * JWT guard (reads on every request) share the exact same key without
 * depending on each other.
 */
export function blacklistKey(token: string): string {
  return `auth:blacklist:${token}`;
}

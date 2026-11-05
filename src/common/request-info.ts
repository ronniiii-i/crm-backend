import { createHash } from 'node:crypto';

/**
 * Request identity helpers shared by rate limiting and session tracking.
 *
 * Everything here is deliberately dependency free. The plan called for
 * `ua-parser-js`, but the deployment image installs dependencies offline, so a
 * small, deterministic parser covers the browsers and operating systems the
 * product supports without adding a runtime package.
 */

/** Strip IPv6-mapped IPv4 prefixes and normalise whitespace. */
export function normalizeIp(value: string | undefined | null): string | null {
  if (!value) return null;
  let ip = value.trim();
  if (ip.length === 0) return null;

  // Express reports IPv4 connections as `::ffff:127.0.0.1` when the server is
  // bound to an IPv6 socket.
  if (ip.toLowerCase().startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  // Strip a zone index (`fe80::1%eth0`).
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);

  return ip.length > 0 ? ip : null;
}

/**
 * IPv4 /24 and IPv6 /64 prefix. Used for device fingerprints so a user moving
 * between addresses inside one network is not treated as a new device, and
 * for rate-limit keys so a single IPv6 host cannot rotate through the whole
 * /64 to bypass a limit.
 */
export function ipPrefix(ip: string | null): string {
  if (!ip) return 'unknown';

  if (!ip.includes(':')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    }
    return ip;
  }

  const [head] = ip.split('%');
  const groups = head.split(':');
  // Compressed IPv6 (`::`) is expanded just far enough to build a /64 from the
  // first four groups. An address that starts with `::` is a loopback/unspecified
  // address; keep the full value because it carries no network identity.
  if (head.startsWith('::') || groups.length < 4) return head;

  return `${groups.slice(0, 4).join(':')}::/64`;
}

/** SHA-256 hex digest. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Device fingerprint: user agent plus the IP prefix.
 *
 * The raw user agent is never persisted in the fingerprint; only the digest is.
 */
export function deviceFingerprint(
  userAgent: string | null | undefined,
  ip: string | null,
): string {
  return sha256(`${userAgent?.trim() || 'unknown'}|${ipPrefix(ip)}`);
}

export interface ParsedUserAgent {
  browser: string | null;
  os: string | null;
  label: string;
}

/**
 * Minimal, deterministic user-agent parser.
 *
 * Order matters: Edge and Opera also contain `Chrome`, and Chrome on iOS also
 * contains `Safari`.
 */
export function parseUserAgent(
  userAgent: string | null | undefined,
): ParsedUserAgent {
  if (!userAgent || userAgent.trim().length === 0) {
    return { browser: null, os: null, label: 'Unknown device' };
  }

  const ua = userAgent.toLowerCase();

  let browser: string | null = null;
  if (ua.includes('edg/') || ua.includes('edge/')) browser = 'Edge';
  else if (ua.includes('opr/') || ua.includes('opera')) browser = 'Opera';
  else if (ua.includes('firefox/') || ua.includes('fxios/'))
    browser = 'Firefox';
  else if (ua.includes('chrome/') || ua.includes('crios/')) browser = 'Chrome';
  else if (ua.includes('safari/')) browser = 'Safari';
  else if (ua.includes('curl/')) browser = 'curl';

  let os: string | null = null;
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('android')) os = 'Android';
  else if (
    ua.includes('iphone') ||
    ua.includes('ipad') ||
    ua.includes('ipod')
  ) {
    os = 'iOS';
  } else if (ua.includes('mac os x') || ua.includes('macintosh')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';

  if (browser && os) return { browser, os, label: `${browser} on ${os}` };
  if (browser) return { browser, os, label: browser };
  if (os) return { browser, os, label: os };
  return { browser, os, label: 'Unknown device' };
}

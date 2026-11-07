import { Injectable, Optional } from '@nestjs/common';

export type RootDomainMode = 'path' | 'subdomain';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * Central tenant-aware URL builder for outbound email.
 *
 * Path mode (default):   https://app.example.com/<slug>/<path>
 * Subdomain mode:        https://<slug>.app.example.com/<path>
 *
 * `path` is treated as raw segments: each segment is encoded exactly once, so
 * callers must not pre-encode tokens. Query values are encoded exactly once by
 * `URLSearchParams`.
 */
@Injectable()
export class EmailLinkService {
  private readonly appUrl: string;
  private readonly mode: RootDomainMode;

  constructor(
    @Optional()
    appUrl = process.env.APP_URL?.trim() ||
      process.env.FRONTEND_URL?.trim() ||
      'http://localhost:3000',
    @Optional()
    mode: RootDomainMode = process.env.ROOT_DOMAIN_MODE === 'subdomain'
      ? 'subdomain'
      : 'path',
  ) {
    this.appUrl = appUrl.replace(/\/+$/, '');
    this.mode = mode;
  }

  build(slug: string, path: string, query?: Record<string, string>): string {
    if (!SLUG_PATTERN.test(slug)) {
      throw new Error(`Invalid workspace slug: "${slug}"`);
    }

    const url = new URL(this.appUrl);
    const pathSegments = path
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => encodeURIComponent(segment));
    const canonicalPath = pathSegments.join('/');

    if (this.mode === 'subdomain') {
      url.hostname = `${slug}.${url.hostname}`;
      url.pathname = canonicalPath ? `/${canonicalPath}` : '/';
    } else {
      url.pathname = canonicalPath ? `/${slug}/${canonicalPath}` : `/${slug}`;
    }

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }
}

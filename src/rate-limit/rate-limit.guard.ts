import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { normalizeIp, ipPrefix } from '../common/request-info';
import {
  RATE_LIMIT_KEY,
  SKIP_RATE_LIMIT_KEY,
  type RateLimitOptions,
} from './rate-limit.decorator';
import {
  resolvePolicyNames,
  type RateLimitPolicyName,
} from './rate-limit-policy';
import { RateLimitService } from './rate-limit.service';

const RATE_LIMITED_BODY = {
  statusCode: HttpStatus.TOO_MANY_REQUESTS,
  code: 'RATE_LIMITED',
  message: 'Too many requests. Try again shortly.',
};

interface RequestIdentity {
  /** IP used for the key; IPv6 is collapsed to its /64 network. */
  ip: string;
  tenantSlug: string | null;
  sub: string | null;
  email: string | null;
  route: string;
}

/**
 * Identity-aware rate-limit guard.
 *
 * Registered before `JwtAuthGuard` so abusive unauthenticated traffic is
 * rejected without touching the database. The `sub` claim is obtained from a
 * verified token only; an invalid token falls back to the IP bucket and the
 * JWT guard still rejects the request.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if ((process.env.RATE_LIMIT_ENFORCE ?? 'true').toLowerCase() === 'false') {
      return true;
    }

    if (
      this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    const route = this.routeOf(request);
    const method = String(request.method ?? 'GET').toUpperCase();

    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const policies = this.resolvePolicies(method, route, options);
    if (policies.length === 0) return true;

    const identity = await this.identify(request, route);
    const now = Date.now();
    const results: Array<{
      policy: RateLimitPolicyName;
      result: Awaited<ReturnType<RateLimitService['consume']>>;
    }> = [];

    for (const policy of policies) {
      const result = await this.rateLimit.consume(
        policy,
        this.buildKey(policy, identity),
        {
          limit: options?.limit,
          windowMs: options?.windowMs,
        },
        now,
      );
      results.push({ policy, result });
    }

    const denied = results.find((entry) => !entry.result.allowed);
    const header = (denied ?? results[0]).result;

    if (response?.setHeader) {
      const resetSeconds = Math.max(
        0,
        Math.ceil((header.resetAt - now) / 1000),
      );
      response.setHeader('RateLimit-Limit', String(header.limit));
      response.setHeader('RateLimit-Remaining', String(header.remaining));
      response.setHeader('RateLimit-Reset', String(resetSeconds));
    }

    if (denied) {
      const retryAfter = Math.max(
        1,
        Math.ceil((denied.result.resetAt - now) / 1000),
      );
      response?.setHeader?.('Retry-After', String(retryAfter));
      throw new HttpException(RATE_LIMITED_BODY, HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }

  private resolvePolicies(
    method: string,
    route: string,
    options: RateLimitOptions | undefined,
  ): RateLimitPolicyName[] {
    if (options?.policy) {
      return Array.isArray(options.policy) ? options.policy : [options.policy];
    }
    return resolvePolicyNames(method, route);
  }

  private routeOf(request: any): string {
    const raw = request.path || request.originalUrl || request.url || '/';
    const withoutQuery = String(raw).split('?')[0];
    return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  }

  private async identify(
    request: any,
    route: string,
  ): Promise<RequestIdentity> {
    const ip = this.rateLimitIp(
      normalizeIp(request.ip) ??
        normalizeIp(request.socket?.remoteAddress) ??
        'unknown',
    );

    const headerSlug = request.headers?.['x-tenant-slug'];
    const bodySlug = request.body?.tenantSlug ?? request.body?.tenant;
    const bodyEmail = request.body?.email;

    let sub: string | null = null;
    let tokenSlug: string | null = null;
    const token = this.extractToken(request);
    if (token) {
      try {
        const payload = await this.jwtService.verifyAsync(token);
        if (payload?.scope !== 'system' && typeof payload?.sub === 'string') {
          sub = payload.sub;
        }
        if (typeof payload?.tenantSlug === 'string') {
          tokenSlug = payload.tenantSlug;
        }
      } catch {
        // Invalid/expired tokens are handled by JwtAuthGuard. The rate limit
        // falls back to the IP bucket so it cannot be bypassed with a bogus
        // per-user key.
      }
    }

    return {
      ip,
      tenantSlug:
        (typeof headerSlug === 'string' && headerSlug) ||
        (typeof bodySlug === 'string' && bodySlug) ||
        tokenSlug,
      sub,
      email:
        typeof bodyEmail === 'string' ? bodyEmail.trim().toLowerCase() : null,
      route,
    };
  }

  private buildKey(
    policy: RateLimitPolicyName,
    identity: RequestIdentity,
  ): string {
    switch (policy) {
      case 'auth-credential':
        return `${identity.ip}|${identity.tenantSlug ?? ''}|${identity.route}`;
      case 'auth-credential-hour':
        return `${identity.ip}|${identity.tenantSlug ?? ''}`;
      case 'auth-login-account':
        return identity.email ?? identity.ip;
      case 'public-form':
        return identity.ip;
      default:
        return identity.sub ?? identity.ip;
    }
  }

  /** IPv4 keeps the exact address; IPv6 is collapsed to /64. */
  private rateLimitIp(ip: string): string {
    if (ip === 'unknown') return ip;
    return ip.includes(':') ? ipPrefix(ip) : ip;
  }

  private extractToken(request: any): string | undefined {
    const header = request.headers?.authorization;
    if (typeof header !== 'string') return undefined;
    const [type, token] = header.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}

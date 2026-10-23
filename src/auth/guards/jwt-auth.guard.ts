import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { CacheService } from '../../cache/cache.service';
import { blacklistKey } from '../blacklist-key';
import { Request } from 'express';

interface JwtPayload {
  sub: string;
  userId?: string;
  email: string;
  tenantId?: string;
}

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly jwtService: JwtService,
    private readonly cache: CacheService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    // Revocation is stored in the cache (Redis when available, bounded
    // in-process fallback otherwise). The previous implementation queried
    // `blacklisted_tokens` on EVERY request; with RLS enabled and no tenant
    // context set that lookup always returned null, so it was both ineffective
    // and four extra round trips per request.
    const key = this.cache.tenantKey(
      blacklistKey(token),
      payload.tenantId ?? 'global',
    );
    if (await this.cache.get<boolean>(key)) {
      throw new UnauthorizedException('Token has been invalidated');
    }

    request.user = payload;
    return super.canActivate(context) as Promise<boolean>;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  override handleRequest<TUser = any>(err: unknown, user: TUser | null): TUser {
    if (err instanceof Error || !user) {
      throw new UnauthorizedException(
        err instanceof Error ? err.message : 'Unauthorized',
      );
    }
    return user;
  }
}

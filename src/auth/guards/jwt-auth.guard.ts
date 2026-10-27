import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { CacheService } from '../../cache/cache.service';
import { blacklistKey } from '../blacklist-key';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { SessionStateService } from '../services/session-state.service';

export const SKIP_JWT_GUARD = 'skipJwtGuard';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly cache: CacheService,
    private readonly sessionState: SessionStateService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const path = req?.path || req?.url || '';
    if (path.startsWith('/system-admin')) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = req;
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      // For non-public routes without token, still let Passport strategy run
      // to be safe; Passport will typically throw if unauthenticated
      try {
        const activated = await super.canActivate(context);
        return activated as boolean;
      } catch {
        throw new UnauthorizedException('No token provided');
      }
    }

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    if (payload?.scope === 'system') {
      throw new UnauthorizedException('Invalid token');
    }

    const key = this.cache.tenantKey(
      blacklistKey(token),
      payload.tenantId ?? 'global',
    );
    if (await this.cache.get<boolean>(key)) {
      throw new UnauthorizedException('Token has been invalidated');
    }

    try {
      await this.sessionState.assertFresh(payload);
    } catch (error: any) {
      throw new UnauthorizedException(error?.message ?? 'SESSION_REVOKED');
    }

    request.user = payload;
    const activated = await super.canActivate(context);
    return activated as boolean;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const auth = request.headers?.authorization;
    if (typeof auth !== 'string') {
      return undefined;
    }
    const [type, token] = auth.split(' ');
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

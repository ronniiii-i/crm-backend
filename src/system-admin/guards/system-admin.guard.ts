import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { SYSTEM_ADMIN_ROUTE_KEY } from '../../auth/decorators/system-admin-route.decorator';

@Injectable()
export class SystemAdminGuard extends AuthGuard('system-admin') implements CanActivate {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isSystemAdmin = this.reflector.getAllAndOverride<boolean>(
      SYSTEM_ADMIN_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!isSystemAdmin) {
      return true;
    }

    const activated = await super.canActivate(context);
    if (!activated) {
      throw new UnauthorizedException('Unauthorized');
    }

    return true;
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

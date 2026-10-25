import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { SYSTEM_ADMIN_ROUTE_KEY } from '../auth/decorators/system-admin-route.decorator';
import { ALLOW_LOCKED_TENANT_KEY } from '../auth/decorators/allow-locked-tenant.decorator';
import { TenantStateService } from './tenant-state.service';

@Injectable()
export class TenantLifecycleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantState: TenantStateService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const isSystemAdmin = this.reflector.getAllAndOverride<boolean>(
      SYSTEM_ADMIN_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isSystemAdmin) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.tenantId) {
      return true;
    }

    const state = await this.tenantState.getState(user.tenantId);

    if (state.status === 'ACTIVE' || state.status === 'TRIAL') {
      return true;
    }

    const allowLocked = this.reflector.getAllAndOverride<boolean>(
      ALLOW_LOCKED_TENANT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (allowLocked) {
      if (user.isTenantAdmin) {
        return true;
      }
    }

    if (state.status === 'PAST_DUE') {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Workspace is past due',
        code: 'TENANT_PAST_DUE',
      });
    }

    if (state.status === 'SUSPENDED') {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Workspace is suspended',
        code: 'TENANT_SUSPENDED',
      });
    }

    return true;
  }
}

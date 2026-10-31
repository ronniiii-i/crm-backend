import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  MODULE_ACTION_KEY,
} from '../decorators/module-action.decorator';
import {
  ModuleAccessService,
  ModuleAction,
} from '../services/module-access.service';

interface WorkspaceRequest {
  user?: Record<string, unknown>;
  params?: Record<string, string>;
  moduleAccess?: unknown;
}

/**
 * Authorises a workspace route against the module resolved from
 * `:deptKey/:moduleKey` and attaches the resolved access to the request.
 *
 * Runs after the global `JwtAuthGuard`, which populates `request.user`.
 */
@Injectable()
export class ModulePermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: ModuleAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<ModuleAction>(
      MODULE_ACTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!action) {
      // Fail closed: a workspace route without declared metadata is a bug.
      throw new ForbiddenException({
        code: 'MODULE_ACTION_UNDECLARED',
        message: 'Workspace route is missing module action metadata.',
      });
    }

    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    const deptKey = request.params?.deptKey;
    const moduleKey = request.params?.moduleKey;
    const user = request.user;

    if (!user || !deptKey || !moduleKey) {
      throw new ForbiddenException({
        code: 'MODULE_CONTEXT_MISSING',
        message: 'Workspace module context is missing.',
      });
    }

    const access = await this.access.requireAction(
      user as Parameters<ModuleAccessService['requireAction']>[0],
      deptKey,
      moduleKey,
      action,
    );

    request.moduleAccess = access;
    return true;
  }
}

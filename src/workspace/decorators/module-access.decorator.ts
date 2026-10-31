import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ResolvedModuleAccess } from '../services/module-access.service';

/**
 * Injects the module access resolved by `ModulePermissionGuard`.
 *
 * Controllers never rebuild permissions themselves; the guard already
 * validated the requested action and attached the effective scope.
 */
export const CurrentModuleAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ResolvedModuleAccess => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ moduleAccess?: ResolvedModuleAccess }>();
    return request.moduleAccess as ResolvedModuleAccess;
  },
);

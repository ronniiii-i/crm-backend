import { SetMetadata } from '@nestjs/common';
import { ModuleAction } from '../services/module-access.service';

export const MODULE_ACTION_KEY = 'workspace.module_action';

/**
 * Declares the workspace permission required by a route.
 *
 * The value is checked by `ModulePermissionGuard` against the module resolved
 * from `:deptKey/:moduleKey` — the static `@RequirePermission` registry is not
 * involved, so new modules work without a code change.
 */
export const RequireModuleAction = (action: ModuleAction) =>
  SetMetadata(MODULE_ACTION_KEY, action);

import { SetMetadata } from '@nestjs/common';
import { ModuleAction } from '../services/module-access.service';

export const MODULE_ACTION_KEY = 'workspace.module_action';

/**
 * Declares the workspace permission required by a route.
 *
 * The value is checked by `ModulePermissionGuard` against the module resolved
 * from `:deptKey/:moduleKey` — the static `@RequirePermission` registry is not
 * involved, so new modules work without a code change.
 *
 * Passing an array requires *any* one of the listed actions. This is used by
 * workflow routes where a state-machine transition may legitimately be
 * authorised by either `CREATE` or `EDIT`.
 */
export const RequireModuleAction = (action: ModuleAction | ModuleAction[]) =>
  SetMetadata(MODULE_ACTION_KEY, action);

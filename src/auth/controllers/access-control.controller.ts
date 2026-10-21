import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { User } from '../decorators/user.decorator';
import { FrontendAdapterService } from '../frontend-adapter.service';
import {
  UserWithDepartments,
  AccessibleModule,
  Permission,
} from '../permission-types';
import {
  PermissionResolutionService,
  EffectivePermission,
} from '../services/permission-resolution.service';

@Controller('auth/acl')
@UseGuards(JwtAuthGuard)
export class AuthAclController {
  constructor(
    private readonly frontendAdapter: FrontendAdapterService,
    private readonly permissionResolution: PermissionResolutionService,
  ) {}

  @Get('modules')
  async getModules(
    @User() user: UserWithDepartments,
  ): Promise<AccessibleModule[]> {
    return this.frontendAdapter.getAccessibleModules(user);
  }

  /**
   * Effective permissions for the signed-in user with their provenance
   * (role base, group or override). The UI uses the provenance to render
   * the `Role+` indicator.
   */
  @Get('permissions')
  async getPermissions(
    @User() user: UserWithDepartments,
  ): Promise<{
    permissions: EffectivePermission[];
    enhanced: boolean;
  }> {
    const details = await this.permissionResolution.getEffectivePermissionDetails(
      user,
    );
    const enhanced = await this.permissionResolution.hasEnhancedPermissions(
      user,
    );

    return {
      permissions: Array.from(details.values()),
      enhanced,
    };
  }

  @Get('check-permission/:moduleId/:action')
  async checkPermission(
    @User() user: UserWithDepartments,
    @Param('moduleId') moduleId: string,
    @Param('action') action: Permission,
  ): Promise<{ hasPermission: boolean }> {
    const hasPermission = await this.permissionResolution.hasPermission(
      user,
      moduleId,
      action as any,
    );

    return { hasPermission };
  }
}

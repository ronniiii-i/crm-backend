import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { User } from '../decorators/user.decorator';
import { FrontendAdapterService } from '../frontend-adapter.service';
import {
  UserWithDepartments,
  ProtectedRoute,
  Permission,
} from '../permission-types';

@Controller('auth/acl')
export class AuthAclController {
  constructor(private readonly frontendAdapter: FrontendAdapterService) {}

  @Get('modules')
  @UseGuards(JwtAuthGuard)
  async getModules(
    @User() user: UserWithDepartments,
  ): Promise<ProtectedRoute[]> {
    return this.frontendAdapter.getAccessibleModules(user);
  }

  @Get('check-permission/:moduleId/:action')
  @UseGuards(JwtAuthGuard)
  async checkPermission(
    @User() user: UserWithDepartments,
    @Param('moduleId') moduleId: string,
    @Param('action') action: Permission,
  ): Promise<{ hasPermission: boolean }> {
    const modules = await this.frontendAdapter.getAccessibleModules(user);
    const module = modules.find((m) => m.id === moduleId);
    return {
      hasPermission: module?.permissions[user.role]?.includes(action) ?? false,
    };
  }
}

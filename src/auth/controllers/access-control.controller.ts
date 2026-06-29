import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { User } from '../decorators/user.decorator';
import { FrontendAdapterService } from '../frontend-adapter.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UserWithDepartments,
  AccessibleModule,
  Permission,
} from '../permission-types';

@Controller('auth/acl')
@UseGuards(JwtAuthGuard)
export class AuthAclController {
  constructor(
    private readonly frontendAdapter: FrontendAdapterService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('modules')
  async getModules(
    @User() user: UserWithDepartments,
  ): Promise<AccessibleModule[]> {
    return this.frontendAdapter.getAccessibleModules(user);
  }

  @Get('check-permission/:moduleId/:action')
  async checkPermission(
    @User() user: UserWithDepartments,
    @Param('moduleId') moduleId: string,
    @Param('action') action: Permission,
  ): Promise<{ hasPermission: boolean }> {
    const permission = await this.prisma.permission.findUnique({
      where: { type: action as any },
    });

    if (!permission) return { hasPermission: false };

    const entry = await this.prisma.roleModulePermission.findFirst({
      where: {
        role: user.role as any,
        moduleId,
        permissionId: permission.id,
      },
    });

    return { hasPermission: !!entry };
  }
}

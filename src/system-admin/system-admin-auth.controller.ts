import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { SystemAdminAuthService } from './system-admin-auth.service';
import { SystemLoginDto } from './dto/system-login.dto';
import { SystemAdminGuard } from './guards/system-admin.guard';
import { SystemAdminRoute } from '../auth/decorators/system-admin-route.decorator';

@Controller('system-admin/auth')
export class SystemAdminAuthController {
  constructor(private readonly auth: SystemAdminAuthService) {}

  @Post('login')
  async login(@Body() dto: SystemLoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @UseGuards(SystemAdminGuard)
  @SystemAdminRoute()
  @Get('verify')
  async verify(@Req() req: any) {
    return { success: true, admin: req.user };
  }

  @UseGuards(SystemAdminGuard)
  @SystemAdminRoute()
  @Post('logout')
  async logout(@Req() req: any) {
    return this.auth.logout(req);
  }
}

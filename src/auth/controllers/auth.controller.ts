import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from '../services/auth.service';
import { LoginDto } from '../dto/login.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { VerifyEmailDto } from '../dto/verify-email.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../decorators/public.decorator';
import { User } from '../decorators/user.decorator';
import { AllowLockedTenant } from '../decorators/allow-locked-tenant.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 900000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password, body.tenantSlug);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @Post('verify-email')
  async verifyEmail(@Body() body: VerifyEmailDto) {
    return this.authService.verifyEmail(body.token, body.tenantSlug);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(body.email, body.tenantSlug);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @Post('reset-password')
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(
      body.token,
      body.newPassword,
      body.tenantSlug,
    );
  }

  @UseGuards(JwtAuthGuard)
  @AllowLockedTenant()
  @Post('refresh')
  async refresh(@User() user: any) {
    return this.authService.refresh(user);
  }

  @UseGuards(JwtAuthGuard)
  @AllowLockedTenant()
  @Post('logout')
  async logout(@Req() req: any) {
    const authHeader = req.headers?.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    return this.authService.logout(token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('verify')
  verify(@User() user: any) {
    return { success: true, user };
  }

  @UseGuards(JwtAuthGuard)
  @Get('acl/modules')
  getAclModules(@User() user: any) {
    return this.authService.getAclModules(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('acl/permissions')
  getAclPermissions(@User() user: any) {
    return this.authService.getAclPermissions(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('acl/check-permission')
  checkPermission() {
    return { success: true };
  }
}

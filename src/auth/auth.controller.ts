import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

@Controller('auth')
@UseGuards(ThrottlerGuard) // Apply throttler to all routes in this controller
export class AuthController {
  constructor(private authService: AuthService) {}

  // More lenient limits for registration
  @Throttle({ default: { limit: 5, ttl: 3600000 } }) // 5 per hour
  @Post('register')
  async signup(
    @Body() signupDto: SignupDto,
  ): Promise<{ success: boolean; message: string }> {
    const { email, password, name } = signupDto;
    return await this.authService.signup(email, password, name);
  }

  // Stricter limits for login with burst protection
  @Throttle({
    default: { limit: 5, ttl: 3600000 }, // 5 per hour (long term)
    short: { limit: 3, ttl: 10000 }, // 3 per 10 seconds (burst)
  })
  @Post('login')
  async login(@Body() body: LoginDto): Promise<{
    success: boolean;
    message: string;
    user: { email: string; name: string };
    accessToken: string;
  }> {
    return this.authService.login(body.email, body.password);
  }

  // Moderate limits for email verification
  @Throttle({ default: { limit: 10, ttl: 3600000 } }) // 10 per hour
  @Post('verify-email')
  async verifyEmail(@Body() body: { token: string }) {
    return this.authService.verifyEmail(body.token);
  }

  // Stricter limits for password reset requests
  @Throttle({ default: { limit: 3, ttl: 3600000 } }) // 3 per hour
  @Post('request-password-reset')
  async requestPasswordReset(@Body() body: { email: string }) {
    return this.authService.requestPasswordReset(body.email);
  }

  // Moderate limits for actual password reset
  @Throttle({ default: { limit: 5, ttl: 3600000 } }) // 5 per hour
  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; newPassword: string }) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  // Protected routes can have higher limits
  @Throttle({ default: { limit: 60, ttl: 60000 } }) // 60 per minute
  @UseGuards(JwtAuthGuard)
  @Get('protected')
  getProtected(
    @Req() req: { user: { id: string; email: string; name: string } },
  ) {
    return { message: 'Protected route accessed!', user: req.user };
  }

  @Throttle({ default: { limit: 60, ttl: 60000 } }) // 60 per minute
  @UseGuards(JwtAuthGuard)
  @Get('verify')
  verifyToken(@Req() req: { user: { id: string; email: string } }) {
    return {
      success: true,
      user: req.user,
    };
  }
}

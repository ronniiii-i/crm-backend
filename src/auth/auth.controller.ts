import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async signup(
    @Body() signupDto: SignupDto,
  ): Promise<{ success: boolean; message: string }> {
    const { email, password, name } = signupDto;
    return await this.authService.signup(email, password, name);
  }

  @Post('login')
  async login(@Body() body: LoginDto): Promise<{
    success: boolean;
    message: string;
    user: { email: string; name: string };
    accessToken: string;
  }> {
    return this.authService.login(body.email, body.password);
  }

  @Post('verify-email')
  async verifyEmail(@Body() body: { token: string }) {
    return this.authService.verifyEmail(body.token);
  }

  @Post('request-password-reset')
  async requestPasswordReset(@Body() body: { email: string }) {
    return this.authService.requestPasswordReset(body.email);
  }

  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; newPassword: string }) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Get('protected')
  getProtected(
    @Req() req: { user: { id: string; email: string; name: string } },
  ) {
    return { message: 'Protected route accessed!', user: req.user };
  }

  @UseGuards(JwtAuthGuard)
  @Get('verify')
  verifyToken(@Req() req: { user: { id: string; email: string } }) {
    return {
      success: true,
      user: req.user,
    };
  }

  // src/users/users.controller.ts
  // @Get('profile')
  // @UseGuards(JwtAuthGuard)
  // async getProfile(@Req() req: Request) {
  //   const userId = req.user.sub; // From JWT
  //   return this.usersService.findById(userId);
  // }
}

import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
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
  async login(
    @Body() body: { email: string; password: string },
  ): Promise<{ success: boolean; message: string }> {
    return this.authService.login(body.email, body.password);
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
}

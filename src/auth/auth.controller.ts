import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
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
}

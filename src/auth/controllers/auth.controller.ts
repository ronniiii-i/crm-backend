import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { SignupDto } from '../dto/signup.dto';
import { LoginDto } from '../dto/login.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
// import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

@Controller('auth')
// @UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private authService: AuthService,
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @Post('register')
  async signup(@Body() signupDto: SignupDto) {
    const { email, password, name } = signupDto;
    return await this.authService.signup(email, password, name);
  }

  // @Throttle({
  //   default: { limit: 5, ttl: 3600000 },
  //   short: { limit: 3, ttl: 10000 },
  // })
  @Post('login')
  async login(@Body() body: LoginDto) {
    const result = await this.authService.login(body.email, body.password);

    const userWithDepts = await this.prisma.user.findUnique({
      where: { id: result.user?.id },
      include: {
        department: {
          select: {
            id: true,
            name: true,
          },
        },
        managedDepartment: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!userWithDepts) {
      throw new NotFoundException('User not found');
    }

    return {
      ...result,
      user: {
        ...result.user,
        department: userWithDepts.department,
        managedDepartment: userWithDepts.managedDepartment,
      },
    };
  }

  // @Throttle({ default: { limit: 10, ttl: 3600000 } })
  @Post('verify-email')
  async verifyEmail(@Body() body: { token: string }) {
    return this.authService.verifyEmail(body.token);
  }

  // @Throttle({ default: { limit: 3, ttl: 3600000 } })
  @Post('request-password-reset')
  async requestPasswordReset(@Body() body: { email: string }) {
    return this.authService.requestPasswordReset(body.email);
  }

  // @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; newPassword: string }) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  // @Throttle({ default: { limit: 60, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  @Get('protected')
  getProtected(
    @Req()
    req: {
      user: { id: string; email: string; role: string; verified: boolean };
    },
  ) {
    return { message: 'Protected route accessed!', user: req.user };
  }

  // @Throttle({ default: { limit: 60, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  @Get('verify')
  verifyToken(
    @Req()
    req: {
      user: {
        id: string;
        email: string;
        name: string;
        role: string;
        isVerified: boolean;
        department: { id: string; name: string }[];
        managedDepartment: { id: string; name: string }[];
      };
    },
  ) {
    return {
      success: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        role: req.user.role,
        isVerified: req.user.isVerified,
        departments: req.user.department,
        managedDepartment: req.user.managedDepartment,
      },
    };
  }

  @Post('refresh')
  async refreshToken(
    @Req()
    req: {
      cookies?: { token?: string };
      headers: { authorization?: string };
    },
  ) {
    const token =
      req.cookies?.token || req.headers.authorization?.split(' ')[1] || null;

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const payload = this.jwtService.verify<{ sub: string; email: string }>(
        token,
        { ignoreExpiration: true },
      );
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      const newToken = this.jwtService.sign(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
        },
        { expiresIn: '1h' },
      );

      return { token: newToken };
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  // @Throttle({ default: { limit: 60, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(
    @Req()
    req: {
      user: {
        id: string;
        email: string;
      };
      headers: { authorization?: string };
    },
  ) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }
    return this.authService.logout(req.user.id, token);
  }
}

import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Res,
  NotFoundException,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from '../services/auth.service';
import { SignupDto } from '../dto/signup.dto';
import { LoginDto } from '../dto/login.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
// import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { User } from '../decorators/user.decorator';
import { Department } from '../permission-types';

@Controller('auth')
// @UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private authService: AuthService,
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // @Throttle({ default: { limit: 5, ttl: 3600000 } })
  // @Post('register')
  // async signup(@Body() signupDto: SignupDto) {
  //   const { email, password, name } = signupDto;
  //   return await this.authService.signup(email, password, name);
  // }
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: SignupDto) {
    return this.authService.signup(body.email, body.password, body.name);
  }

  // @Throttle({
  //   default: { limit: 5, ttl: 3600000 },
  //   short: { limit: 3, ttl: 10000 },
  // })
  // @Post('login')
  // async login(@Body() body: LoginDto) {
  //   const result = await this.authService.login(body.email, body.password);

  //   const userWithDepts = await this.prisma.user.findUnique({
  //     where: { id: result.user?.id },
  //     include: {
  //       department: {
  //         select: {
  //           id: true,
  //           name: true,
  //         },
  //       },
  //       managedDepartment: {
  //         select: {
  //           id: true,
  //           name: true,
  //         },
  //       },
  //     },
  //   });

  //   if (!userWithDepts) {
  //     throw new NotFoundException('User not found');
  //   }

  //   return {
  //     ...result,
  //     user: {
  //       ...result.user,
  //       department: userWithDepts.department,
  //       managedDepartment: userWithDepts.managedDepartment,
  //     },
  //   };
  // }
  // @Post('login')
  // async login(
  //   @Body() body: LoginDto,
  //   @Res({ passthrough: true }) response: Response,
  // ) {
  //   const result = await this.authService.login(body.email, body.password);

  //   // Set the token as an HTTP-only cookie
  //   response.cookie('access_token', result.accessToken, {
  //     httpOnly: true,
  //     secure: process.env.NODE_ENV === 'production', // Use secure in production
  //     sameSite: 'lax', // Or 'strict' depending on your needs
  //     maxAge: 3600000, // 1 hour in milliseconds, adjust to match token expiry
  //   });

  //   const userWithDepts = await this.prisma.user.findUnique({
  //     where: { id: result.user?.id },
  //     include: {
  //       department: {
  //         select: {
  //           id: true,
  //           name: true,
  //         },
  //       },
  //       managedDepartment: {
  //         select: {
  //           id: true,
  //           name: true,
  //         },
  //       },
  //     },
  //   });

  //   if (!userWithDepts) {
  //     throw new NotFoundException('User not found');
  //   }

  //   return {
  //     ...result,
  //     user: {
  //       ...result.user,
  //       department: userWithDepts.department,
  //       managedDepartment: userWithDepts.managedDepartment,
  //     },
  //   };
  // }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(body.email, body.password);

    // Set the JWT as an HTTP-only cookie
    // 'access_token' is a common name for the cookie
    response.cookie('access_token', result.accessToken, {
      httpOnly: true, // Crucial for security: makes cookie inaccessible to client-side JS
      secure: process.env.NODE_ENV === 'production', // Only send over HTTPS in production
      sameSite: 'lax', // Protects against CSRF in some cases, 'strict' is more secure but can break cross-site links
      maxAge: 3600000, // 1 hour in milliseconds (adjust to match your JWT expiry time)
    });

    // Remove the `userWithDepts` re-fetch. The `authService.login` now includes the department info and modules.
    return {
      success: result.success,
      message: result.message,
      user: result.user, // The user object now includes department, managedDepartment, and accessibleModules
      accessToken: result.accessToken, // You can choose to omit this from the *response body* if only using cookies,
      // but keeping it for client-side localStorage access is common.
    };
  }

  // // @Throttle({ default: { limit: 10, ttl: 3600000 } })
  // @Post('verify-email')
  // async verifyEmail(@Body() body: { token: string }) {
  //   return this.authService.verifyEmail(body.token);
  // }

  // // @Throttle({ default: { limit: 3, ttl: 3600000 } })
  // @Post('request-password-reset')
  // async requestPasswordReset(@Body() body: { email: string }) {
  //   return this.authService.requestPasswordReset(body.email);
  // }

  // // @Throttle({ default: { limit: 5, ttl: 3600000 } })
  // @Post('reset-password')
  // async resetPassword(@Body() body: { token: string; newPassword: string }) {
  //   return this.authService.resetPassword(body.token, body.newPassword);
  // }

  // // @Throttle({ default: { limit: 60, ttl: 60000 } })
  // @UseGuards(JwtAuthGuard)
  // @Get('protected')
  // getProtected(
  //   @Req()
  //   req: {
  //     user: { id: string; email: string; role: string; verified: boolean };
  //   },
  // ) {
  //   return { message: 'Protected route accessed!', user: req.user };
  // }

  // // @Throttle({ default: { limit: 60, ttl: 60000 } })
  // @UseGuards(JwtAuthGuard)
  // @Get('verify')
  // verifyToken(
  //   @Req()
  //   req: {
  //     user: {
  //       id: string;
  //       email: string;
  //       name: string;
  //       role: string;
  //       isVerified: boolean;
  //       department: { id: string; name: string }[];
  //       managedDepartment: { id: string; name: string }[];
  //     };
  //   },
  // ) {
  //   return {
  //     success: true,
  //     user: {
  //       id: req.user.id,
  //       email: req.user.email,
  //       name: req.user.name,
  //       role: req.user.role,
  //       isVerified: req.user.isVerified,
  //       departments: req.user.department,
  //       managedDepartment: req.user.managedDepartment,
  //     },
  //   };
  // }

  // @Post('refresh')
  // async refreshToken(
  //   @Req()
  //   req: {
  //     cookies?: { token?: string };
  //     headers: { authorization?: string };
  //   },
  // ) {
  //   const token =
  //     req.cookies?.token || req.headers.authorization?.split(' ')[1] || null;

  //   if (!token) {
  //     throw new UnauthorizedException('No token provided');
  //   }
  //   if (!token) {
  //     throw new UnauthorizedException('No token provided');
  //   }

  //   try {
  //     const payload = this.jwtService.verify<{ sub: string; email: string }>(
  //       token,
  //       { ignoreExpiration: true },
  //     );
  //     const user = await this.prisma.user.findUnique({
  //       where: { id: payload.sub },
  //     });

  //     if (!user) {
  //       throw new UnauthorizedException('User not found');
  //     }

  //     const newToken = this.jwtService.sign(
  //       {
  //         sub: user.id,
  //         email: user.email,
  //         role: user.role,
  //       },
  //       { expiresIn: '1h' },
  //     );

  //     return { token: newToken };
  //   } catch {
  //     throw new UnauthorizedException('Invalid token');
  //   }
  // }

  // @Throttle({ default: { limit: 60, ttl: 60000 } })
  // @UseGuards(JwtAuthGuard)
  // @Post('logout')
  // logout(
  //   @Req()
  //   req: {
  //     user: {
  //       id: string;
  //       email: string;
  //     };
  //     headers: { authorization?: string };
  //   },
  // ) {
  //   const token = req.headers.authorization?.split(' ')[1];
  //   if (!token) {
  //     throw new UnauthorizedException('No token provided');
  //   }
  //   return this.authService.logout(req.user.id, token);
  // }

  // @Post('logout')
  // @UseGuards(JwtAuthGuard) // Protect logout
  // logout(@Res({ passthrough: true }) response: Response) {
  //   // Invalidate token on backend (if you have a blacklist)
  //   // await this.authService.blacklistToken(request.user.token); // You might need to get the token from the request
  //   response.clearCookie('access_token'); // Clear the httpOnly cookie
  //   return { success: true, message: 'Logged out successfully' };
  // }

  @Post('logout')
  @UseGuards(JwtAuthGuard) // Protect this endpoint so only authenticated users can log out
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request & { headers: { authorization?: string } },
    @Res({ passthrough: true }) response: Response,
    @User() user: any,
  ) {
    // Optionally blacklist the token if you have a token blacklisting mechanism
    const token = req.headers.authorization?.split(' ')[1]; // Get token from header
    if (token) {
      await this.authService.logout(user.id, token); // Call service logout to blacklist token
    }

    // Clear the HTTP-only cookie
    response.clearCookie('access_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    return { success: true, message: 'Logged out successfully' };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() body: { token: string }) {
    return this.authService.verifyEmail(body.token);
  }

  @Post('request-password-reset')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.requestPasswordReset(body.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() body: { token: string; newPassword: string }) {
    return this.authService.resetPassword(body.token, body.newPassword);
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard) // Protect this endpoint for refresh
  @HttpCode(HttpStatus.OK)
  async refresh(
    @User() user: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    // The JwtAuthGuard already validated the old token and populated `req.user`
    // We create a new token based on the user data from the validated old token
    const newToken = this.authService.generateTokenFromPayload({
      sub: user.sub,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      managedDepartmentId: user.managedDepartmentId,
      verified: user.verified,
    });

    response.cookie('access_token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600000,
    });

    // Also return in body for client-side localStorage update
    return { accessToken: newToken };
  }

  @Get('verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async verify(@User() userPayload: any) {
    // Fetch full user details from DB to ensure up-to-date department info etc.
    const user = await this.authService.findUserById(userPayload.sub); // Assuming you have a method like this in AuthService

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get accessible modules using the frontend adapter, as this is used by useAuth to populate initial state
    const userForAcl = {
      id: user.id,
      role: user.role as 'ADMIN' | 'HOD' | 'LEAD' | 'STAFF',
      department: user.department
        ? { name: user.department.name as Department }
        : undefined,
      managedDepartment: user.managedDepartment
        ? { name: user.managedDepartment.name as Department }
        : undefined,
    };
    const accessibleModules =
      await this.authService['frontendAdapter'].getAccessibleModules(
        userForAcl,
      );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
        department: user.department,
        managedDepartment: user.managedDepartment,
        accessibleModules: accessibleModules,
      },
    };
  }
}

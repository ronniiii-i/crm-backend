import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { FrontendAdapterService } from '../frontend-adapter.service';
import { Department } from '../permission-types';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '@prisma/client';
import { MailService } from '../../mail/mail.service';
import { addHours } from 'date-fns';

interface DecodedToken {
  exp?: number;
  [key: string]: unknown;
}

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private mailService: MailService,
    private frontendAdapter: FrontendAdapterService,
  ) {}

  async signup(email: string, password: string, name: string) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const verifyToken = this.mailService.generateToken();

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        role: Role.STAFF,
        verifyToken,
        verifyExpires: addHours(new Date(), 3),
      },
    });

    await this.mailService.sendVerificationEmail(email, name, verifyToken);

    return {
      success: true,
      message: 'Registration successful! Please check your email.',
      user: { email: user.email, name: user.name },
    };
  }

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        verifyToken: token,
        verifyExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        verifyToken: null,
        verifyExpires: null,
      },
    });

    return { success: true, message: 'Email verified successfully!' };
  }

  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return {
        success: true,
        message: 'If an account exists, you will receive an email',
      };
    }

    const resetToken = this.mailService.generateToken();

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken,
        resetExpires: addHours(new Date(), 1),
      },
    });

    await this.mailService.sendPasswordResetEmail(email, user.name, resetToken);
    return { success: true, message: 'Password reset email sent' };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        resetToken: token,
        resetExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetExpires: null,
      },
    });

    return { success: true, message: 'Password reset successful' };
  }

  generateTokenFromPayload(payload: any): string {
    return this.jwtService.sign(payload);
  }

  async findUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true } },
        managedDepartment: { select: { id: true, name: true } },
      },
    });
  }

  // async login(email: string, password: string) {
  //   const user = await this.prisma.user.findUnique({
  //     where: { email },
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

  //   if (!user) {
  //     throw new UnauthorizedException('Invalid Email');
  //   }

  //   const isMatch = await bcrypt.compare(password, user.password);
  //   if (!isMatch) {
  //     throw new UnauthorizedException('Invalid Password');
  //   }
  //   if (!user.isVerified) {
  //     throw new UnauthorizedException('Email not verified');
  //   }
  //   const payload = {
  //     sub: user.id,
  //     email: user.email,
  //     role: user.role,
  //     departmentId: user.department?.id || null,
  //     managedDepartmentId: user.managedDepartment?.id || null,
  //     verified: user.isVerified,
  //   };

  //   const token = this.jwtService.sign(payload);
  //   console.log('JWT Secret:', process.env.JWT_SECRET);

  //   return {
  //     success: true,
  //     message: 'Login successful!',
  //     user: {
  //       id: user.id,
  //       email: user.email,
  //       name: user.name,
  //       role: user.role,
  //       isVerified: user.isVerified,
  //       departments: user.department,
  //       managedDepartment: user.managedDepartment,
  //     },
  //     accessToken: token,
  //   };
  // }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
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

    if (!user) {
      throw new UnauthorizedException('Invalid Email');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid Password');
    }
    if (!user.isVerified) {
      throw new UnauthorizedException('Email not verified');
    }

    // Ensure user object has the structure expected by getAccessibleModules
    const userForAcl = {
      id: user.id,
      role: user.role as 'ADMIN' | 'HOD' | 'LEAD' | 'STAFF', // Cast role to expected type
      department: user.department
        ? { name: user.department.name as Department }
        : undefined,
      managedDepartment: user.managedDepartment
        ? { name: user.managedDepartment.name as Department }
        : undefined,
    };

    // Get accessible modules using the frontend adapter
    const accessibleModules =
      await this.frontendAdapter.getAccessibleModules(userForAcl);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.department?.id || null,
      managedDepartmentId: user.managedDepartment?.id || null,
      verified: user.isVerified,
    };

    const token = this.jwtService.sign(payload);
    console.log('JWT Secret:', process.env.JWT_SECRET);

    return {
      success: true,
      message: 'Login successful!',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
        department: user.department,
        managedDepartment: user.managedDepartment,
        // Include accessible modules directly in the user object
        accessibleModules: accessibleModules,
      },
      accessToken: token, // Still return accessToken in body for client-side JS storage
    };
  }

  // async logout(userId: string, token: string) {
  //   const decoded: string | object | null = this.jwtService.decode(token);

  //   if (
  //     !decoded ||
  //     typeof decoded !== 'object' ||
  //     typeof (decoded as DecodedToken).exp !== 'number'
  //   ) {
  //     throw new UnauthorizedException('Invalid token');
  //   }

  //   const expiresAt = new Date(((decoded as DecodedToken)?.exp ?? 0) * 1000);

  //   await this.prisma.blacklistedToken.create({
  //     data: {
  //       token,
  //       userId,
  //       expiresAt,
  //     },
  //   });

  //   return { success: true, message: 'Logout successful!' };
  // }

  async logout(token: string) {
    let userId: string | null = null;
    let expiresAt: Date | null = null;
    let decodedToken: DecodedToken | null = null;

    try {
      // Attempt to decode the token. This works even for expired tokens (does not verify signature or expiry).
      decodedToken = this.jwtService.decode(token);

      if (
        decodedToken &&
        typeof decodedToken === 'object' &&
        typeof decodedToken.exp === 'number'
      ) {
        userId = decodedToken.sub as string;
        expiresAt = new Date(decodedToken.exp * 1000);
      } else {
        console.warn(
          'Logout service: Could not decode token or extract expiry/user ID.',
        );
      }
    } catch (e) {
      console.warn(
        'Logout service: Error decoding token for blacklisting:',
        (e as Error)?.message ?? e,
      );
      // Proceed without blacklisting if token is malformed, but still return success for cookie clearing
    }

    if (token && userId && expiresAt) {
      // Only attempt blacklisting if we have a valid token string and derived user/expiry
      // Check if the token is already blacklisted to prevent duplicates
      const existingBlacklistedToken =
        await this.prisma.blacklistedToken.findUnique({
          where: { token },
        });

      if (existingBlacklistedToken) {
        console.warn(
          `Logout service: Token for userId ${userId} already blacklisted. No new entry created.`,
        );
        return { success: true, message: 'Token already invalidated.' };
      }

      await this.prisma.blacklistedToken.create({
        data: {
          token,
          userId, // Blacklist with the derived userId
          expiresAt,
        },
      });
      console.log(
        `Logout service: Token for userId ${userId} blacklisted successfully. Expires at: ${expiresAt.toISOString()}`,
      );
    } else if (token) {
      console.warn(
        'Logout service: Token present but could not derive userId or expiry for blacklisting.',
      );
    } else {
      console.log('Logout service: No token provided for blacklisting.');
    }

    return { success: true, message: 'Logout successful!' };
  }
}

// async refreshToken(token: string) {
//   try {
//     const payload = this.jwtService.verify<{
//       sub: string;
//       email: string;
//       role: string;
//       verified: boolean;
//     }>(token);
//     const user = await this.prisma.user.findUnique({
//       where: { id: payload.sub },
//       include: {
//         department: {
//           select: {
//             id: true,
//             name: true,
//           },
//         },
//         managedDepartment: {
//           select: {
//             id: true,
//             name: true,
//           },
//         },
//       },
//     });

//     if (!user) {
//       throw new UnauthorizedException('User not found');
//     }

//     const newToken = this.jwtService.sign({
//       sub: user.id,
//       email: user.email,
//       role: user.role,
//       verified: user.isVerified,
//     });

//     return {
//       success: true,
//       message: 'Token refreshed successfully',
//       accessToken: newToken,
//     };
//   } catch {
//     throw new UnauthorizedException('Invalid token');
//   }
// }

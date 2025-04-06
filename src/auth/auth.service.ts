// src/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service'; // Add this
import { Role } from '@prisma/client'; // Auto-generated types
import { MailService } from '../mail/mail.service'; // Add this
import { addHours } from 'date-fns'; // npm install date-fns

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  // async validateUser(
  //   password: string,
  //   hashedPassword: string,
  // ): Promise<boolean> {
  //   return bcrypt.compare(password, hashedPassword);
  // }

  async signup(email: string, password: string, name: string) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const verifyToken = this.mailService.generateToken();

    // Check if user exists using Prisma
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    // Create user in database
    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        role: Role.USER,
        verifyToken,
        verifyExpires: addHours(new Date(), 3), // Expires in 3 hours
      },
    });
    // Send verification email
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

    if (!user) throw new UnauthorizedException('Invalid or expired token');

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
    if (!user)
      return {
        success: true,
        message: 'If an account exists, you will receive an email',
      };

    const resetToken = this.mailService.generateToken();

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken,
        resetExpires: addHours(new Date(), 1), // Expires in 1 hour
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

    if (!user) throw new UnauthorizedException('Invalid or expired token');

    await this.prisma.user.updateMany({
      where: { email: user.email },
      data: {
        resetToken: null,
        resetExpires: null,
      },
    });

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

  async login(email: string, password: string) {
    // Find user in database
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid Email');
    }
    // if (!user.isVerified) throw new UnauthorizedException('Email not verified');

    // Validate password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid Password');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      verified: user.isVerified,
    };
    const token = this.jwtService.sign(payload);

    return {
      success: true,
      message: 'Login successful!',
      user: {
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
      },
      accessToken: token,
    };
  }
}

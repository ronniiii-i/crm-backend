// src/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service'; // Add this
import { Role } from '@prisma/client'; // Auto-generated types

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService, // Inject Prisma
  ) {}

  async validateUser(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  async signup(email: string, password: string, name: string) {
    const hashedPassword = await bcrypt.hash(password, 10);

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
        role: Role.USER, // Or Role.USER if you prefer
      },
    });

    return {
      success: true,
      message: 'User registered successfully.',
      user: { email: user.email, name: user.name },
    };
  }

  async login(email: string, password: string) {
    // Find user in database
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Validate password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate JWT token (unchanged)
    const payload = { sub: user.id, email: user.email, role: user.role };
    const token = this.jwtService.sign(payload);

    return {
      success: true,
      message: 'Login successful!',
      user: { email: user.email, name: user.name },
      accessToken: token,
    };
  }
}

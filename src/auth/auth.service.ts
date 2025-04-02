import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

interface User {
  id: string;
  role: string;
  email: string;
  password: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}
  private users: User[] = []; // Temporary in-memory storage

  async validateUser(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  async signup(email: string, password: string, name: string) {
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if user already exists
    const existingUser = this.users.find((u) => u.email === email);
    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    const user: User = {
      id: crypto.randomUUID(),
      email,
      name,
      password: hashedPassword,
      role: 'admin',
    };
    this.users.push(user);

    return {
      success: true,
      message: 'User registered successfully.',
      user: { email, name },
    };
  }

  async login(email: string, password: string) {
    const user = this.users.find((u) => u.email === email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate JWT token
    const payload = { sub: user.id, email: user.email, role: user.role };
    const token = this.jwtService.sign(payload);

    return {
      success: true,
      message: 'Login successful!',
      user: { email, name: user.name },
      accessToken: token, // Send this token to frontend
    };
  }
}

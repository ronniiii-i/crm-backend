import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { CacheService } from '../cache/cache.service';
import { requireEnv } from '../config/env';

@Injectable()
export class SystemAdminAuthService {
  constructor(
    private readonly systemPrisma: SystemPrismaService,
    private readonly jwtService: JwtService,
    private readonly cache: CacheService,
  ) {}

  async login(email: string, password: string) {
    const admin = await this.systemPrisma.systemAdmin.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, (admin as any).passwordHash || (admin as any).password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const jti = randomUUID();
    const token = this.jwtService.sign(
      {
        sub: admin.id,
        email: admin.email,
        aud: 'system-admin',
        iss: 'claspcrm-system',
        scope: 'system',
        role: admin.role,
        jti,
      },
      { secret: requireEnv('SYSTEM_JWT_SECRET') },
    );

    await this.systemPrisma.systemAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      success: true,
      accessToken: token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
    };
  }

  async logout(req: any) {
    const token = req.headers?.authorization?.slice(7);
    if (token) {
      try {
        const payload = this.jwtService.decode(token) as any;
        if (payload?.exp) {
          const ttl = payload.exp - Math.floor(Date.now() / 1000);
          if (ttl > 0 && payload?.jti) {
            await this.cache.set(`system:bl:${payload.jti}`, true, ttl);
          }
        }
      } catch {
        // ignore
      }
    }
    return { success: true, message: 'Logged out' };
  }
}

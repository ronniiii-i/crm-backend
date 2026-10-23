import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { requireEnv } from '../config/env';

interface SessionClaims {
  sub: string;
  email?: string;
  role: string;
  tenantId?: string;
  departmentId?: string | null;
  managedDepartmentId?: string | null;
  departmentType?: string | null;
  managedDepartmentType?: string | null;
  verified?: boolean;
  /** Token schema version. 2 = claims are complete; omit = legacy token. */
  tv?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Validated at boot by env.validation.ts — no insecure fallback.
      secretOrKey: requireEnv('JWT_SECRET'),
      ignoreExpiration: false,
    });
  }

  async validate(payload: SessionClaims) {
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token');
    }

    // Tokens issued since the session-claims change carry everything the
    // guards need (identity, role, tenant and department *types*). Trusting
    // the signed claims removes a tenant-scoped transaction from EVERY
    // authenticated request, which dominated latency against a remote
    // database. Department names are loaded once per session by
    // `GET /auth/verify`.
    if (payload.tv === 2) {
      return this.fromClaims(payload);
    }

    // Legacy tokens (minted before the change) still need a lookup so existing
    // sessions keep working until they expire/refresh.
    return this.fromDatabase(payload);
  }

  private fromClaims(payload: SessionClaims) {
    const department = payload.departmentId
      ? { id: payload.departmentId, type: payload.departmentType ?? undefined }
      : null;
    const managedDepartment = payload.managedDepartmentId
      ? {
          id: payload.managedDepartmentId,
          type: payload.managedDepartmentType ?? undefined,
        }
      : null;

    // For a department head the *managed* department is their scope; for other
    // roles it is their own department.
    const departmentId =
      payload.role === 'HOD' && payload.managedDepartmentId
        ? payload.managedDepartmentId
        : (payload.departmentId ?? undefined);

    return {
      id: payload.sub,
      userId: payload.sub,
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId,
      isVerified: payload.verified ?? false,
      verified: payload.verified ?? false,
      departmentId,
      managedDepartmentId: payload.managedDepartmentId ?? undefined,
      department,
      departments: department,
      managedDepartment,
    };
  }

  private async fromDatabase(payload: SessionClaims) {
    // The tenant id is embedded in the JWT at login, so the lookup can run
    // inside the tenant context and satisfy RLS.
    const include = {
      department: {
        select: { id: true, name: true, type: true },
      },
      managedDepartment: {
        select: { id: true, name: true, type: true },
      },
    } as const;

    const user = payload.tenantId
      ? await this.prisma.withTenant(payload.tenantId, (tx) =>
          tx.user.findUnique({ where: { id: payload.sub }, include }),
        )
      : await this.prisma.user.findUnique({
          where: { id: payload.sub },
          include,
        });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const departmentId =
      payload.role === 'HOD' && user.managedDepartment
        ? user.managedDepartment.id
        : (user.department?.id ?? undefined);

    return {
      ...user,
      userId: user.id,
      id: user.id,
      sub: user.id,
      tenantId: user.tenantId,
      departmentId,
      role: payload.role,
      departments: user.department,
      managedDepartment: user.managedDepartment,
    };
  }
}

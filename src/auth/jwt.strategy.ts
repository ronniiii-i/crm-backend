import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || 'supersecret',
      ignoreExpiration: false,
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    role: string;
    tenantId?: string;
  }) {
    // The tenant id is embedded in the JWT at login, so the lookup can run
    // inside the tenant context and satisfy RLS. The middleware may not have
    // resolved a tenant yet at guard time, so scope explicitly here.
    const include = {
      department: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
      managedDepartment: {
        select: {
          id: true,
          name: true,
          type: true,
        },
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

    // Determine the relevant departmentId based on the user's role
    let departmentId: string | undefined;
    if (payload.role === 'HOD' && user.managedDepartment) {
      // Assuming 'HOD' is your Role enum value for Department Head
      departmentId = user.managedDepartment.id;
    } else if (user.department) {
      // For other roles like LEAD, STAFF, who belong to a department
      departmentId = user.department.id;
    }

    return {
      ...user,
      userId: user.id,
      id: user.id,
      tenantId: user.tenantId,
      departmentId: departmentId,
      role: payload.role,
      departments: user.department,
      managedDepartment: user.managedDepartment,
    };
  }
}

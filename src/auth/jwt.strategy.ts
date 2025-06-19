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
    console.log(
      'JwtStrategy secretOrKey:',
      process.env.JWT_SECRET || 'supersecret',
    );
  }

  async validate(payload: { sub: string; email: string; role: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
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
      throw new UnauthorizedException('User not found');
    }
    console.log('JWT Secret:', process.env.JWT_SECRET);

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
      departmentId: departmentId,
      role: payload.role,
      departments: user.department,
      managedDepartment: user.managedDepartment,
    };
  }
}

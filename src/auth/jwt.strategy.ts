import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { requireEnv } from '../config/env';
import { UserSessionService } from './services/user-session.service';

export interface JwtAuthPayload {
  sub: string;
  email: string;
  tenantId: string;
  tenantSlug: string;
  roleId: string;
  roleSlug: string;
  roleName: string;
  roleRank: number;
  isTenantAdmin: boolean;
  dataScope: string;
  departmentId: string | null;
  departmentKey: string | null;
  managedDepartmentId: string | null;
  managedDepartmentKey: string | null;
  tenantStatus: string;
  sv: number;
  tsv: number;
  tv: number;
  aud: string;
  iss: string;
  scope?: string;
  jti?: string;
  /** Active session row id. */
  sid: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly userSession: UserSessionService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: requireEnv('JWT_SECRET'),
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtAuthPayload) {
    if (!payload?.sub || !payload.tenantId || !payload.tenantSlug) {
      throw new UnauthorizedException('Invalid token');
    }

    if (payload.tv !== 3 || payload.aud !== 'tenant') {
      throw new UnauthorizedException('Invalid token');
    }

    if (payload.scope === 'system') {
      throw new UnauthorizedException('Invalid token');
    }

    await this.userSession.assertActive(payload);

    return {
      id: payload.sub,
      userId: payload.sub,
      sub: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      tenantSlug: payload.tenantSlug,
      roleId: payload.roleId,
      roleSlug: payload.roleSlug,
      roleName: payload.roleName,
      roleRank: payload.roleRank,
      isTenantAdmin: payload.isTenantAdmin === true,
      dataScope: payload.dataScope,
      departmentId: payload.departmentId ?? null,
      departmentKey: payload.departmentKey ?? null,
      managedDepartmentId: payload.managedDepartmentId ?? null,
      managedDepartmentKey: payload.managedDepartmentKey ?? null,
      tenantStatus: payload.tenantStatus,
      sv: payload.sv,
      tsv: payload.tsv,
      tv: payload.tv,
      aud: payload.aud,
      iss: payload.iss,
      sid: payload.sid,
    };
  }
}

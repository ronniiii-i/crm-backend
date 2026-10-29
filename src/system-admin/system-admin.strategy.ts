import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { requireEnv } from '../config/env';

interface SystemJwtPayload {
  sub: string;
  email: string;
  aud: string;
  iss: string;
  scope: string;
  role: string;
  jti?: string;
}

@Injectable()
export class SystemAdminStrategy extends PassportStrategy(
  Strategy,
  'system-admin',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: requireEnv('SYSTEM_JWT_SECRET'),
      ignoreExpiration: false,
    });
  }

  validate(payload: SystemJwtPayload) {
    if (
      !payload?.sub ||
      payload.aud !== 'system-admin' ||
      payload.iss !== 'claspcrm-system' ||
      payload.scope !== 'system'
    ) {
      throw new UnauthorizedException('Invalid token');
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      scope: payload.scope,
      jti: payload.jti,
    };
  }
}

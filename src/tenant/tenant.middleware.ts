import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { runWithTenant } from './tenant-context';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly jwtService: JwtService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const path = req.path || req.originalUrl || '';

    if (path.startsWith('/system-admin')) {
      return next();
    }

    let tenantId: string | undefined;
    let tenantSlug: string | null = null;

    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

      if (token) {
        const payload = this.jwtService.verify(token);
        if (payload?.scope === 'system') {
          throw new UnauthorizedException('Invalid token');
        }
        tenantId = payload?.tenantId;
        tenantSlug = payload?.tenantSlug ?? null;

        const headerSlug = req.headers['x-tenant-slug'] as string | undefined;
        if (headerSlug && tenantSlug && headerSlug !== tenantSlug) {
          throw new UnauthorizedException('Tenant mismatch');
        }
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // Ignore verification failures; auth guards enforce security.
    }

    if (tenantId) {
      return runWithTenant(tenantId, () => next(), tenantSlug);
    }

    return next();
  }
}

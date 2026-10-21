import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { runWithTenant } from './tenant-context';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly jwtService: JwtService) {}

  use(req: Request, res: Response, next: NextFunction) {
    let tenantId: string | undefined;

    try {
      const authHeader = req.headers['authorization'] as string | undefined;
      const cookieToken = (req as any).cookies?.['access_token'] as
        | string
        | undefined;
      const token =
        cookieToken ||
        (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

      if (token) {
        const payload = this.jwtService.decode(token) as {
          tenantId?: string;
        } | null;
        tenantId = payload?.tenantId;
      }

      // Fallbacks: explicit header (service-to-service) or a value attached
      // to the request by an earlier middleware/guard.
      if (!tenantId) {
        tenantId =
          ((req as any).tenantId as string | undefined) ||
          (req.headers['x-tenant-id'] as string | undefined);
      }
    } catch {
      // Fail open here; the auth guard is responsible for rejecting
      // unauthenticated requests. Missing tenant context is fail-closed at
      // the database layer via RLS.
    }

    if (tenantId) {
      return runWithTenant(tenantId, () => next());
    }

    // No tenant resolved: continue without a tenant context so that the
    // request-scoped interceptor does NOT set app.current_tenant. RLS then
    // returns zero rows (fail-closed) instead of leaking another tenant.
    return next();
  }
}

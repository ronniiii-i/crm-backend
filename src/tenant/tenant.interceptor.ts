import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { getTenantId, getTenantSlug } from './tenant-context';

/**
 * Observability + guard-rail interceptor for the request tenant context.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const tenantId = getTenantId();
    const tenantSlug = getTenantSlug();
    const req = context.switchToHttp().getRequest();

    if (req) {
      req.tenantId = tenantId ?? null;
      req.tenantSlug = tenantSlug ?? null;
    }

    return next.handle();
  }
}

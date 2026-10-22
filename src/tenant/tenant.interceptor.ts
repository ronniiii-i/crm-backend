import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { getTenantId } from './tenant-context';

/**
 * Observability + guard-rail interceptor for the request tenant context.
 *
 * The tenant id is carried in AsyncLocalStorage by {@link TenantMiddleware} and
 * consumed by services to scope their Prisma queries. Row Level Security is
 * enforced separately via {@link PrismaService.withTenant} for code paths that
 * opt into a transaction-scoped `app.current_tenant` setting.
 *
 * This interceptor intentionally does NOT issue a pool-wide `SET` because
 * Prisma uses a connection pool and a session-level write on one connection
 * would not reliably apply to the query that follows on another connection.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const tenantId = getTenantId();
    const req = context.switchToHttp().getRequest();

    if (req) {
      // Expose the resolved tenant for logging/tracing downstream.
      req.tenantId = tenantId ?? null;
    }

    return next.handle();
  }
}

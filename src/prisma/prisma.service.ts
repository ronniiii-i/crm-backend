// src/prisma/prisma.service.ts
import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Prisma client with an explicit tenant transaction helper.
 *
 * Multi-tenant enforcement has two layers:
 *
 *  1. Application layer — services scope their queries by `tenantId`
 *     (resolved from the request tenant context, an AsyncLocalStorage).
 *  2. Database layer — Postgres Row Level Security policies read
 *     `current_setting('app.current_tenant', true)` and fail closed (0 rows)
 *     when the setting is not present.
 *
 * RLS requires the setting on the SAME pooled connection as the query. Because
 * Prisma pools connections, a plain global `SET` is not reliable, so scoped
 * code paths run inside {@link withTenant}, which pins a transaction to one
 * connection and sets the variable with `SET LOCAL`.
 *
 * Code paths that do not set a tenant still fail closed at the database layer:
 * a pooled connection without `app.current_tenant` returns zero rows from every
 * RLS-protected table.
 */
@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'beforeExit'>
  implements OnModuleInit
{
  [x: string]: any;

  async onModuleInit() {
    await this.$connect();
  }

  /**
   * Run `fn` inside a transaction where `app.current_tenant` is set for the
   * duration of the transaction (and therefore on a single connection).
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_tenant', $1, true)`,
          tenantId,
        );
        return fn(tx);
      },
      { timeout: 30000, maxWait: 15000 },
    );
  }

  enableShutdownHooks(app: INestApplication) {
    this.$on('beforeExit', () => {
      app.close().catch((error) => {
        console.error('Error during app shutdown:', error);
      });
    });
  }
}

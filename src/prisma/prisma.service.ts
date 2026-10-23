import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

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

  /**
   * The transaction currently open for this async call chain.
   *
   * `withTenant` is frequently nested (login → user lookup → ACL resolution →
   * module list; verify → user + modules). Opening a fresh transaction for
   * each call costs `BEGIN` + `DEALLOCATE ALL` + `set_config` + `COMMIT` — four
   * extra round trips each. Against a remote database that latency dominates
   * every request, so an already-open transaction for the same tenant is
   * reused.
   */
  private readonly tenantTx = new AsyncLocalStorage<{
    tenantId: string;
    tx: Prisma.TransactionClient;
  }>();

  constructor() {
    super({
      // Opt-in query timing: set PRISMA_LOG_QUERIES=true to print every query
      // and its duration. Off by default (it is verbose and slows the app).
      log:
        process.env.PRISMA_LOG_QUERIES === 'true'
          ? [{ emit: 'event', level: 'query' }]
          : [],
    });
  }

  async onModuleInit() {
    if (process.env.PRISMA_LOG_QUERIES === 'true') {
      (this as any).$on(
        'query',
        (event: { duration: number; query: string }) => {
          console.log(
            `[prisma] ${event.duration}ms ${event.query.replace(/\s+/g, ' ').slice(0, 160)}`,
          );
        },
      );
    }
    await this.$connect();
  }

  /**
   * Run `fn` inside a transaction where `app.current_tenant` is set for the
   * duration of the transaction (and therefore on a single connection).
   *
   * Nested calls for the same tenant join the caller's transaction instead of
   * opening (and committing) another one, which removes several network round
   * trips from every authenticated request.
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const active = this.tenantTx.getStore();
    if (active?.tenantId === tenantId) {
      return fn(active.tx);
    }

    return this.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_tenant', $1, true)`,
          tenantId,
        );
        return this.tenantTx.run({ tenantId, tx }, () => fn(tx));
      },
      // The dashboard builder issues many sequential aggregates. On a
      // high-latency link the 30s default is not enough.
      { timeout: 120000, maxWait: 15000 },
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

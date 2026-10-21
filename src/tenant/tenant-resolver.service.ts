import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves the tenant that owns a user/credential BEFORE a request tenant
 * context exists (login, signup, email verification, password reset).
 *
 * These paths cannot use ordinary Prisma queries against RLS-protected tables
 * because `app.current_tenant` is not yet set and the policies would match zero
 * rows. Instead they call narrowly scoped SECURITY DEFINER functions
 * (see prisma/sql/auth_lookup_user.sql) that read across tenants for
 * authentication purposes only.
 */
@Injectable()
export class TenantResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tenant owning the given email address, or null when no account exists. */
  async resolveTenantByEmail(email: string): Promise<string | null> {
    const rows = await this.prisma.$queryRawUnsafe<{ tenantId: string | null }[]>(
      `SELECT auth_lookup_tenant_by_email($1) AS "tenantId"`,
      email,
    );
    return rows[0]?.tenantId ?? null;
  }

  /**
   * Tenant owning the user identified by a one-time token.
   * @param column one of `verifyToken` | `resetToken`
   */
  async resolveTenantByToken(
    column: 'verifyToken' | 'resetToken',
    token: string,
  ): Promise<string | null> {
    const rows = await this.prisma.$queryRawUnsafe<{ tenantId: string | null }[]>(
      `SELECT auth_lookup_tenant_by_token($1, $2) AS "tenantId"`,
      column,
      token,
    );
    return rows[0]?.tenantId ?? null;
  }

  /** Tenant owning the given user id. */
  async resolveTenantByUserId(userId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRawUnsafe<{ tenantId: string | null }[]>(
      `SELECT auth_lookup_tenant_by_user_id($1) AS "tenantId"`,
      userId,
    );
    return rows[0]?.tenantId ?? null;
  }

  /**
   * The default (oldest active) tenant. Used by self-service signup to attach a
   * new account when the caller supplies no tenant context.
   */
  async resolveDefaultTenant(): Promise<string | null> {
    const rows = await this.prisma.$queryRawUnsafe<{ tenantId: string | null }[]>(
      `SELECT auth_lookup_default_tenant() AS "tenantId"`,
    );
    return rows[0]?.tenantId ?? null;
  }

  /**
   * Public (RLS-visible) user record for an email, resolved inside the owning
   * tenant's context. Returns null when the account does not exist.
   */
  async findUserByEmailForAuth<T = unknown>(
    email: string,
    select: (tx: PrismaLike) => Promise<T>,
  ): Promise<T | null> {
    const tenantId = await this.resolveTenantByEmail(email);
    if (!tenantId) return null;
    return this.prisma.withTenant(tenantId, (tx) =>
      select(tx as unknown as PrismaLike),
    );
  }
}

/** Minimal structural type for the interactive transaction client. */
export interface PrismaLike {
  [key: string]: any;
}

import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { addHours, subDays } from 'date-fns';
import { CacheService } from '../../cache/cache.service';
import { optionalEnv } from '../../config/env';
import {
  deviceFingerprint,
  normalizeIp,
  parseUserAgent,
} from '../../common/request-info';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemPrismaService } from '../../prisma/system-prisma.service';
import { JwtAuthPayload } from './auth.service';
import { NewDeviceNotifier } from './new-device-notifier.service';
import { SessionStateService } from './session-state.service';

/** Sessions are touched at most once per five minutes. */
const TOUCH_INTERVAL_SECONDS = 5 * 60;

/** A device is "known" when it signed in within this many days. */
const KNOWN_DEVICE_DAYS = 90;

/** Expired rows are retained for this long for support investigations. */
const CLEANUP_RETENTION_DAYS = 30;

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export interface SessionContext extends RequestContext {
  deviceLabel: string;
  fingerprint: string;
}

export interface SessionDto {
  id: string;
  current: boolean;
  deviceLabel: string;
  browser?: string;
  os?: string;
  ip?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface CreateSessionParams {
  tenantId: string;
  userId: string;
  context: SessionContext;
}

/**
 * Active-session lifecycle.
 *
 * Every query goes through `PrismaService.withTenant`, so RLS scopes rows to
 * the caller's tenant even though the API filters by user id as well.
 */
@Injectable()
export class UserSessionService {
  private readonly logger = new Logger(UserSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly systemPrisma: SystemPrismaService,
    private readonly cache: CacheService,
    private readonly sessionState: SessionStateService,
    private readonly newDeviceNotifier: NewDeviceNotifier,
  ) {}

  /** Session lifetime from `AUTH_SESSION_TTL_HOURS` (default 7 days). */
  get ttlHours(): number {
    return Number(optionalEnv('AUTH_SESSION_TTL_HOURS', '168'));
  }

  /** Build the fingerprint/label for a request. */
  contextFromRequest(request: RequestContext): SessionContext {
    const userAgent = request.userAgent?.trim() || null;
    return {
      ip: normalizeIp(request.ip),
      userAgent,
      deviceLabel: parseUserAgent(userAgent).label,
      fingerprint: deviceFingerprint(userAgent, normalizeIp(request.ip)),
    };
  }

  /**
   * Create a session inside an existing tenant transaction.
   *
   * The transaction is shared with `lastLoginAt` and `lastActivityAt` so a
   * login either fully succeeds or leaves no session behind.
   */
  async create(
    tx: Prisma.TransactionClient,
    params: CreateSessionParams,
  ): Promise<{ id: string; expiresAt: Date }> {
    const { tenantId, userId, context } = params;
    const alreadyKnown = await tx.userSession.findFirst({
      where: {
        tenantId,
        userId,
        fingerprint: context.fingerprint,
        revokedAt: null,
        createdAt: { gte: subDays(new Date(), KNOWN_DEVICE_DAYS) },
      },
      select: { id: true },
    });

    const expiresAt = addHours(new Date(), this.ttlHours);
    const session = await tx.userSession.create({
      data: {
        tenantId,
        userId,
        userAgent: context.userAgent,
        ip: context.ip,
        deviceLabel: context.deviceLabel,
        fingerprint: context.fingerprint,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });

    if (!alreadyKnown) {
      await this.newDeviceNotifier.notify(tx, {
        tenantId,
        userId,
        deviceLabel: context.deviceLabel,
        fingerprint: context.fingerprint,
        ip: context.ip,
      });
    }

    return session;
  }

  /**
   * Reject a token whose session is missing, revoked or expired.
   *
   * Called from `JwtStrategy.validate`, so every authenticated request is
   * checked. `lastSeenAt` is only written once per `TOUCH_INTERVAL_SECONDS` to
   * avoid a write per request.
   */
  async assertActive(payload: JwtAuthPayload): Promise<void> {
    if (!payload?.sid || !payload.tenantId || !payload.sub) {
      throw new UnauthorizedException('SESSION_REVOKED');
    }

    const session = await this.prisma.withTenant(payload.tenantId, (tx) =>
      tx.userSession.findUnique({
        where: { id: payload.sid },
        select: {
          id: true,
          userId: true,
          tenantId: true,
          revokedAt: true,
          expiresAt: true,
        },
      }),
    );

    if (
      !session ||
      session.userId !== payload.sub ||
      session.tenantId !== payload.tenantId ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('SESSION_REVOKED');
    }

    await this.touch(payload.tenantId, payload.sid);
  }

  /** List active sessions for the current user. */
  async list(
    tenantId: string,
    userId: string,
    currentSessionId: string | null,
  ): Promise<SessionDto[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.userSession.findMany({
        where: {
          tenantId,
          userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { lastSeenAt: 'desc' },
        select: {
          id: true,
          userAgent: true,
          ip: true,
          deviceLabel: true,
          createdAt: true,
          lastSeenAt: true,
          expiresAt: true,
        },
      }),
    );

    return rows.map((row) => {
      const parsed = parseUserAgent(row.userAgent);
      return {
        id: row.id,
        current: row.id === currentSessionId,
        deviceLabel: row.deviceLabel ?? parsed.label,
        ...(parsed.browser ? { browser: parsed.browser } : {}),
        ...(parsed.os ? { os: parsed.os } : {}),
        ...(row.ip ? { ip: row.ip } : {}),
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      };
    });
  }

  /**
   * Revoke one session owned by the caller.
   *
   * RLS hides other tenants' rows; a row that is not visible is reported as
   * not found rather than forbidden so the API does not confirm existence.
   */
  async revokeSession(
    tenantId: string,
    userId: string,
    sessionId: string,
    reason: string,
  ): Promise<void> {
    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.userSession.updateMany({
        where: {
          id: sessionId,
          tenantId,
          userId,
          revokedAt: null,
        },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
      if (updated.count > 0) {
        await this.recordAudit(
          tx,
          tenantId,
          userId,
          'SESSION_REVOKED',
          sessionId,
          {
            reason,
          },
        );
      }
      return updated;
    });

    if (result.count === 0) {
      throw new NotFoundException('Session not found');
    }
  }

  /** Revoke every other session, keeping the current one alive. */
  async revokeOthers(
    tenantId: string,
    userId: string,
    currentSessionId: string | null,
  ): Promise<number> {
    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.userSession.updateMany({
        where: {
          tenantId,
          userId,
          revokedAt: null,
          ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
        },
        data: { revokedAt: new Date(), revokedReason: 'REVOKE_OTHERS' },
      });
      if (updated.count > 0) {
        await this.recordAudit(
          tx,
          tenantId,
          userId,
          'SESSION_REVOKED_OTHERS',
          currentSessionId,
          { revoked: updated.count },
        );
      }
      return updated;
    });
    return result.count;
  }

  /**
   * Revoke every session and bump the user's `sessionVersion`.
   *
   * The bump is the durable kill switch; revocation rows are the per-session
   * record. The cached version is flushed so the change takes effect at once
   * rather than after the 60-second cache TTL.
   */
  async revokeAll(tenantId: string, userId: string): Promise<number> {
    const revoked = await this.prisma.withTenant(tenantId, async (tx) => {
      const result = await tx.userSession.updateMany({
        where: { tenantId, userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'REVOKE_ALL' },
      });
      await tx.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
      });
      await this.recordAudit(
        tx,
        tenantId,
        userId,
        'SESSION_REVOKED_ALL',
        null,
        { revoked: result.count },
      );
      return result.count;
    });

    await this.sessionState.flushUser(tenantId, userId);
    return revoked;
  }

  /**
   * Delete sessions that expired more than 30 days ago.
   *
   * `crm_system` has no grants on Phase 4 tables, so the tenant list comes
   * from the system connection and each delete runs as `crm_app` under the
   * tenant context.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredSessions(): Promise<number> {
    const cutoff = subDays(new Date(), CLEANUP_RETENTION_DAYS);
    const tenants = await this.systemPrisma.tenant.findMany({
      select: { id: true },
    });

    let deleted = 0;
    for (const tenant of tenants) {
      try {
        const result = await this.prisma.withTenant(tenant.id, (tx) =>
          tx.userSession.deleteMany({
            where: { tenantId: tenant.id, expiresAt: { lt: cutoff } },
          }),
        );
        deleted += result.count;
      } catch (error) {
        this.logger.warn(
          `Session cleanup failed for tenant ${tenant.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} expired user session(s)`);
    }
    return deleted;
  }

  /**
   * Append the session audit row. Audit is best-effort: a logging failure must
   * not leave the session un-revoked.
   */
  private async recordAudit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    action: string,
    sessionId: string | null,
    after: Record<string, unknown>,
  ): Promise<void> {
    try {
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId,
          action,
          entity: 'UserSession',
          entityId: sessionId,
          after: after as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write ${action} audit row: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async touch(tenantId: string, sessionId: string): Promise<void> {
    const key = `session:touch:${tenantId}:${sessionId}`;
    if (await this.cache.get<boolean>(key)) return;

    try {
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.userSession.updateMany({
          where: { id: sessionId, tenantId, revokedAt: null },
          data: { lastSeenAt: new Date() },
        }),
      );
    } catch {
      // A stale `lastSeenAt` must never fail an authenticated request.
    }

    await this.cache.set(key, true, TOUCH_INTERVAL_SECONDS);
  }
}

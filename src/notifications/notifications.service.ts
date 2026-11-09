import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { NOTIFICATION_BUS, NotificationBus } from './notification.bus';
import {
  CreateNotificationInput,
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreferenceRecord,
  NotificationRow,
  NotificationType,
  isNotificationType,
} from './notification.types';

const RETENTION_DAYS = 180;
const MAX_LIST_LIMIT = 100;
const MAX_REPLAY = 50;

export interface NotificationListOptions {
  unread?: boolean;
  limit?: number;
}

export interface UpdatePreferencesInput {
  preferences: Array<{
    type: NotificationType;
    inApp?: boolean;
    email?: boolean;
  }>;
}

/**
 * Persists notifications, applies per-user preferences, and fans them out to
 * live SSE streams.
 *
 * The service is intentionally best-effort: a notification failure must never
 * roll back the business change that triggered it. Callers invoke it *after*
 * their database transaction commits.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_BUS) private readonly bus: NotificationBus,
    @Optional() private readonly systemPrisma?: SystemPrismaService,
  ) {}

  async list(
    tenantId: string,
    userId: string,
    options: NotificationListOptions = {},
  ): Promise<{
    success: true;
    notifications: NotificationRow[];
    unreadCount: number;
  }> {
    const limit = clampLimit(options.limit);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const where = {
        tenantId,
        userId,
        ...(options.unread ? { read: false } : {}),
      };

      const [notifications, unreadCount] = await Promise.all([
        tx.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        tx.notification.count({
          where: { tenantId, userId, read: false },
        }),
      ]);

      return {
        success: true as const,
        notifications: notifications as NotificationRow[],
        unreadCount,
      };
    });
  }

  async unreadCount(
    tenantId: string,
    userId: string,
  ): Promise<{ success: true; unreadCount: number }> {
    const unreadCount = await this.prisma.withTenant(tenantId, (tx) =>
      tx.notification.count({
        where: { tenantId, userId, read: false },
      }),
    );
    return { success: true, unreadCount };
  }

  async markRead(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<{ success: true }> {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.notification.updateMany({
        where: { id, tenantId, userId, read: false },
        data: { read: true, readAt: new Date() },
      }),
    );
    return { success: true };
  }

  async markAllRead(
    tenantId: string,
    userId: string,
  ): Promise<{ success: true; updated: number }> {
    const result = await this.prisma.withTenant(tenantId, (tx) =>
      tx.notification.updateMany({
        where: { tenantId, userId, read: false },
        data: { read: true, readAt: new Date() },
      }),
    );
    return { success: true, updated: result.count };
  }

  async getPreferences(
    tenantId: string,
    userId: string,
  ): Promise<{
    success: true;
    preferences: NotificationPreferenceRecord[];
  }> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.notificationPreference.findMany({
        where: { tenantId, userId },
      }),
    );

    const stored = new Map(
      rows.map((row: any) => [row.type as string, row] as const),
    );

    const preferences = Object.entries(DEFAULT_NOTIFICATION_PREFERENCES).map(
      ([type, defaults]) => {
        const row = stored.get(type);
        return {
          type: type as NotificationType,
          inApp: row?.inApp ?? defaults.inApp,
          email: row?.email ?? defaults.email,
        };
      },
    );

    return { success: true, preferences };
  }

  async updatePreferences(
    tenantId: string,
    userId: string,
    input: UpdatePreferencesInput,
  ): Promise<{
    success: true;
    preferences: NotificationPreferenceRecord[];
  }> {
    const updates = input?.preferences;
    if (!Array.isArray(updates)) {
      throw new BadRequestException({
        code: 'INVALID_PREFERENCES',
        message: 'preferences must be an array.',
      });
    }

    for (const update of updates) {
      if (!isNotificationType(update?.type)) {
        throw new BadRequestException({
          code: 'UNKNOWN_NOTIFICATION_TYPE',
          message: `Unknown notification type "${String(update?.type)}".`,
        });
      }
      if (update.inApp !== undefined && typeof update.inApp !== 'boolean') {
        throw new BadRequestException({
          code: 'INVALID_PREFERENCES',
          message: 'inApp must be a boolean.',
        });
      }
      if (update.email !== undefined && typeof update.email !== 'boolean') {
        throw new BadRequestException({
          code: 'INVALID_PREFERENCES',
          message: 'email must be a boolean.',
        });
      }
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      for (const update of updates) {
        const defaults = DEFAULT_NOTIFICATION_PREFERENCES[update.type];

        await tx.notificationPreference.upsert({
          where: {
            tenantId_userId_type: {
              tenantId,
              userId,
              type: update.type,
            },
          },
          create: {
            tenantId,
            userId,
            type: update.type,
            inApp: update.inApp ?? defaults.inApp,
            email: update.email ?? defaults.email,
          },
          update: {
            ...(update.inApp !== undefined ? { inApp: update.inApp } : {}),
            ...(update.email !== undefined ? { email: update.email } : {}),
          },
        });
      }
    });

    return this.getPreferences(tenantId, userId);
  }

  /** Current effective preference for one user and type. */
  async effectivePreference(
    tenantId: string,
    userId: string,
    type: NotificationType,
  ): Promise<{ inApp: boolean; email: boolean }> {
    const defaults = DEFAULT_NOTIFICATION_PREFERENCES[type];
    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.notificationPreference.findFirst({
        where: { tenantId, userId, type },
      }),
    );

    return {
      inApp: row?.inApp ?? defaults.inApp,
      email: row?.email ?? defaults.email,
    };
  }

  /**
   * Create an in-app notification (deduped), publish it, and optionally send
   * an email when the user has opted in for this type.
   */
  async notify(
    input: CreateNotificationInput,
    email?: () => Promise<unknown>,
  ): Promise<NotificationRow | null> {
    try {
      const preference = await this.effectivePreference(
        input.tenantId,
        input.userId,
        input.type,
      );

      let row: NotificationRow | null = null;

      if (preference.inApp) {
        row = await this.createInApp(input);
        if (row) {
          await this.bus.publish(input.tenantId, input.userId, {
            event: 'notification',
            id: row.id,
            data: {
              id: row.id,
              type: row.type,
              title: row.title,
              message: row.message,
              link: row.link,
              metadata: row.metadata,
              createdAt: row.createdAt,
            },
          });
        }
      }

      if (preference.email && email) {
        await email();
      }

      return row;
    } catch (error) {
      this.logger.warn(
        `Notification delivery failed for ${input.type}: ${describe(error)}`,
      );
      return null;
    }
  }

  private async createInApp(
    input: CreateNotificationInput,
  ): Promise<NotificationRow | null> {
    const existing = input.dedupeKey
      ? await this.prisma.withTenant(input.tenantId, (tx) =>
          tx.notification.findFirst({
            where: {
              tenantId: input.tenantId,
              userId: input.userId,
              dedupeKey: input.dedupeKey,
            },
          }),
        )
      : null;

    if (existing) return existing as NotificationRow;

    try {
      const row = await this.prisma.withTenant(input.tenantId, (tx) =>
        tx.notification.create({
          data: {
            tenantId: input.tenantId,
            userId: input.userId,
            type: input.type,
            title: input.title,
            message: input.message,
            link: input.link ?? null,
            metadata: input.metadata as Prisma.InputJsonValue | undefined,
            dedupeKey: input.dedupeKey ?? null,
          },
        }),
      );
      return row as NotificationRow;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Notify a department manager that a module was provisioned for their
   * department. Called by the Stage 9 provisioning endpoint once it exists;
   * keeping the shape here means the SSE/permission plumbing is already
   * exercised by the notification tests.
   */
  async notifyModuleProvisioned(
    tenantId: string,
    managerId: string,
    departmentKey: string,
    moduleName: string,
    moduleKey: string,
  ): Promise<NotificationRow | null> {
    return this.notify({
      tenantId,
      userId: managerId,
      type: 'SYSTEM',
      title: 'New module provisioned',
      message: `${moduleName} is now available for your department.`,
      link: `/departments/${departmentKey}`,
      dedupeKey: `MODULE_PROVISIONED:${departmentKey}:${moduleKey}:${managerId}`,
      metadata: { departmentKey, moduleKey },
    });
  }

  /** Publish a leave state change to the affected user's stream. */
  publishLeaveEvent(
    tenantId: string,
    userId: string,
    data: Record<string, unknown>,
  ): void {
    void this.bus.publish(tenantId, userId, { event: 'leave', data });
  }

  /** Publish a session event (for example a revocation) to one user. */
  publishSessionEvent(
    tenantId: string,
    userId: string,
    data: Record<string, unknown>,
  ): void {
    void this.bus.publish(tenantId, userId, { event: 'session', data });
  }

  /**
   * Replay notifications newer than `lastEventId` for a reconnecting stream.
   * Unknown ids return an empty list rather than leaking another user's row.
   */
  async replayAfter(
    tenantId: string,
    userId: string,
    lastEventId: string,
  ): Promise<NotificationRow[]> {
    if (!lastEventId) return [];

    return this.prisma.withTenant(tenantId, async (tx) => {
      const anchor = await tx.notification.findFirst({
        where: { id: lastEventId, tenantId, userId },
        select: { id: true, createdAt: true },
      });
      if (!anchor) return [];

      return (await tx.notification.findMany({
        where: {
          tenantId,
          userId,
          createdAt: { gt: anchor.createdAt },
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_REPLAY,
      })) as NotificationRow[];
    });
  }

  /** Nightly retention sweep: read notifications older than 180 days. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async sweepRetention(): Promise<void> {
    if (!this.systemPrisma) return;

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    try {
      const tenants = await this.systemPrisma.tenant.findMany({
        select: { id: true },
      });

      for (const tenant of tenants) {
        await this.prisma.withTenant(tenant.id, (tx) =>
          tx.notification.deleteMany({
            where: {
              tenantId: tenant.id,
              read: true,
              createdAt: { lt: cutoff },
            },
          }),
        );
      }
    } catch (error) {
      this.logger.warn(
        `Notification retention sweep failed: ${describe(error)}`,
      );
    }
  }
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(value as number)));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface NewDeviceNotice {
  tenantId: string;
  userId: string;
  deviceLabel: string;
  fingerprint: string;
  ip?: string | null;
}

/**
 * Records the "new device signed in" notification.
 *
 * Creation is best-effort: a notification failure must never block a login.
 * The dedupe key makes the notification idempotent per device, so a client
 * that retries a login cannot stack duplicates.
 */
@Injectable()
export class NewDeviceNotifier {
  private readonly logger = new Logger(NewDeviceNotifier.name);

  async notify(
    tx: Prisma.TransactionClient,
    notice: NewDeviceNotice,
  ): Promise<void> {
    try {
      await tx.notification.create({
        data: {
          tenantId: notice.tenantId,
          userId: notice.userId,
          type: 'NEW_DEVICE',
          title: 'New sign-in to your workspace',
          message: `A new device signed in: ${notice.deviceLabel}. If this was not you, revoke the session from Account > Security.`,
          link: '/account/security',
          dedupeKey: `NEW_DEVICE:${notice.fingerprint}`,
          metadata: {
            deviceLabel: notice.deviceLabel,
            ip: notice.ip ?? null,
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Already notified for this device.
        return;
      }
      this.logger.warn(
        `Failed to create NEW_DEVICE notification: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

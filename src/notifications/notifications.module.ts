import { Global, Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { SystemPrismaModule } from '../prisma/system-prisma.module';
import {
  LocalNotificationBus,
  NOTIFICATION_BUS,
  NotificationBus,
  RedisNotificationBus,
} from './notification.bus';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Builds the fan-out implementation from the environment.
 *
 * Redis is optional: without `REDIS_URL` the in-process bus is used, which is
 * correct for a single instance and keeps local development dependency-free.
 */
export function createNotificationBus(): NotificationBus {
  const url = process.env.REDIS_URL?.trim();
  return url ? new RedisNotificationBus(url) : new LocalNotificationBus();
}

@Global()
@Module({
  imports: [AuthModule, SystemPrismaModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: NOTIFICATION_BUS,
      useFactory: createNotificationBus,
    },
  ],
  exports: [NotificationsService, NOTIFICATION_BUS],
})
export class NotificationsModule {}

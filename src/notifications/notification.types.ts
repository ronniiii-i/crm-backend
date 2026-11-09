/**
 * Notification catalogue and preference defaults.
 *
 * The catalogue is deliberately closed: an unknown event type is rejected by
 * the preferences endpoint and never rendered by the client. Email remains
 * opt-in per type; in-app delivery is on by default so the bell stays useful
 * even before a user visits their notification settings.
 */

export const NOTIFICATION_TYPES = [
  'TASK_ASSIGNED',
  'LEAVE_SUBMITTED',
  'LEAVE_PROGRESS',
  'LEAVE_DECIDED',
  'NEW_DEVICE',
  'SYSTEM',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationPreferenceDefaults {
  inApp: boolean;
  email: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: Record<
  NotificationType,
  NotificationPreferenceDefaults
> = {
  TASK_ASSIGNED: { inApp: true, email: false },
  LEAVE_SUBMITTED: { inApp: true, email: false },
  LEAVE_PROGRESS: { inApp: true, email: false },
  LEAVE_DECIDED: { inApp: true, email: true },
  NEW_DEVICE: { inApp: true, email: true },
  SYSTEM: { inApp: true, email: false },
};

export interface NotificationPreferenceRecord {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
}

export interface CreateNotificationInput {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
  metadata?: Record<string, unknown> | null;
  dedupeKey?: string | null;
}

export interface NotificationRow {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  metadata: Record<string, unknown> | null;
  dedupeKey: string | null;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export type NotificationStreamEvent =
  | {
      event: 'notification';
      id: string;
      data: Record<string, unknown>;
    }
  | { event: 'session'; data: Record<string, unknown> }
  | { event: 'leave'; data: Record<string, unknown> };

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_TYPES as readonly string[]).includes(value)
  );
}

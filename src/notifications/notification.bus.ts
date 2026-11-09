import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { createClient } from 'redis';

import { NotificationStreamEvent } from './notification.types';

/** Injection token for the fan-out implementation. */
export const NOTIFICATION_BUS = Symbol('NOTIFICATION_BUS');

export type NotificationEventHandler = (event: NotificationStreamEvent) => void;

/**
 * Fan-out contract.
 *
 * Channels are always scoped by tenant *and* user, so a stream can never
 * observe another user's events even when two instances share one bus.
 */
export interface NotificationBus {
  publish(
    tenantId: string,
    userId: string,
    event: NotificationStreamEvent,
  ): Promise<void> | void;
  subscribe(
    tenantId: string,
    userId: string,
    handler: NotificationEventHandler,
  ): () => void;
}

export function notificationChannel(tenantId: string, userId: string): string {
  return `notif:${tenantId}:${userId}`;
}

/**
 * Single-process fan-out used in development, tests, and single-node
 * deployments. It never leaves the process.
 */
export class LocalNotificationBus implements NotificationBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(
    tenantId: string,
    userId: string,
    event: NotificationStreamEvent,
  ): void {
    this.emitter.emit(notificationChannel(tenantId, userId), event);
  }

  subscribe(
    tenantId: string,
    userId: string,
    handler: NotificationEventHandler,
  ): () => void {
    const channel = notificationChannel(tenantId, userId);
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }
}

/**
 * Redis pub/sub fan-out for multi-instance deployments.
 *
 * A dedicated subscriber connection is required because a subscribed Redis
 * client cannot issue regular commands. Every failure path degrades to local
 * delivery so a Redis outage never silences notifications on the instance
 * that produced them.
 */
export class RedisNotificationBus
  implements NotificationBus, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RedisNotificationBus.name);
  private readonly handlers = new Map<string, Set<NotificationEventHandler>>();
  private readonly subscribed = new Set<string>();
  private readonly local = new LocalNotificationBus();
  private publisher: ReturnType<typeof createClient> | null = null;
  private subscriber: ReturnType<typeof createClient> | null = null;
  private ready = false;

  constructor(private readonly url: string) {}

  async onModuleInit(): Promise<void> {
    try {
      const publisher = createClient({
        url: this.url,
        socket: {
          connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT ?? 3000),
          reconnectStrategy: false,
        },
      });
      const subscriber = createClient({
        url: this.url,
        socket: {
          connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT ?? 3000),
          reconnectStrategy: false,
        },
      });

      publisher.on('error', (error: unknown) => {
        this.ready = false;
        this.logger.warn(
          `Redis notification publisher unavailable: ${describe(error)}`,
        );
      });
      subscriber.on('error', (error: unknown) => {
        this.ready = false;
        this.logger.warn(
          `Redis notification subscriber unavailable: ${describe(error)}`,
        );
      });
      subscriber.on('message', (channel: string, payload: string) => {
        const handlers = this.handlers.get(channel);
        if (!handlers || handlers.size === 0) return;
        try {
          const event = JSON.parse(payload) as NotificationStreamEvent;
          for (const handler of handlers) handler(event);
        } catch {
          // Ignore malformed payloads from other producers.
        }
      });

      await Promise.all([publisher.connect(), subscriber.connect()]);
      this.publisher = publisher;
      this.subscriber = subscriber;
      this.ready = true;
      this.logger.log('Redis notification bus connected');

      // Re-subscribe channels that were registered before connect resolved.
      for (const channel of this.subscribed) {
        await subscriber.subscribe(channel, () => undefined);
      }
    } catch (error) {
      this.ready = false;
      this.logger.warn(
        `Redis notification bus unavailable, using in-process delivery: ${describe(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    const clients = [this.publisher, this.subscriber].filter(
      (client): client is ReturnType<typeof createClient> => client !== null,
    );
    this.publisher = null;
    this.subscriber = null;
    this.ready = false;
    for (const client of clients) {
      try {
        await client.quit();
      } catch {
        // The connection is being discarded anyway.
      }
    }
  }

  async publish(
    tenantId: string,
    userId: string,
    event: NotificationStreamEvent,
  ): Promise<void> {
    const channel = notificationChannel(tenantId, userId);

    if (this.ready && this.publisher) {
      try {
        await this.publisher.publish(channel, JSON.stringify(event));
        return;
      } catch (error) {
        this.logger.warn(
          `Redis notification publish failed, delivering locally: ${describe(error)}`,
        );
      }
    }

    this.local.publish(tenantId, userId, event);
  }

  subscribe(
    tenantId: string,
    userId: string,
    handler: NotificationEventHandler,
  ): () => void {
    const channel = notificationChannel(tenantId, userId);
    const handlers = this.handlers.get(channel) ?? new Set();
    handlers.add(handler);
    this.handlers.set(channel, handlers);

    if (this.ready && this.subscriber && !this.subscribed.has(channel)) {
      this.subscribed.add(channel);
      void this.subscriber
        .subscribe(channel, () => undefined)
        .catch((error: unknown) => {
          this.logger.warn(
            `Redis notification subscribe failed: ${describe(error)}`,
          );
        });
    }

    return () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(channel);
        if (this.subscribed.delete(channel) && this.subscriber) {
          void this.subscriber.unsubscribe(channel).catch(() => undefined);
        }
      }
    };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

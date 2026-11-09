import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { User } from '../auth/decorators/user.decorator';
import { SessionStateService } from '../auth/services/session-state.service';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_BUS, NotificationBus } from './notification.bus';
import { Inject } from '@nestjs/common';
import { NotificationStreamEvent } from './notification.types';

const STREAM_LIFETIME_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 25 * 1000;
const SESSION_CHECK_MS = 30 * 1000;
const MAX_CONNECTIONS_PER_USER = 3;

interface StreamConnection {
  res: Response;
  close: () => void;
}

interface RequestUser {
  id?: string;
  sub?: string;
  userId?: string;
  tenantId?: string;
  sid?: string;
  [key: string]: unknown;
}

/** In-app notification inbox and the live SSE stream. */
@Controller('notifications')
export class NotificationsController {
  private readonly connections = new Map<string, Set<StreamConnection>>();

  constructor(
    private readonly notifications: NotificationsService,
    private readonly sessionState: SessionStateService,
    @Inject(NOTIFICATION_BUS) private readonly bus: NotificationBus,
  ) {}

  @Get()
  list(
    @User() user: RequestUser,
    @Query('unread') unread?: string,
    @Query('limit') limit?: string,
  ) {
    const { tenantId, userId } = identity(user);
    return this.notifications.list(tenantId, userId, {
      unread: unread === 'true' || unread === '1',
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Get('unread-count')
  unreadCount(@User() user: RequestUser) {
    const { tenantId, userId } = identity(user);
    return this.notifications.unreadCount(tenantId, userId);
  }

  @Patch(':id/read')
  @HttpCode(200)
  markRead(@User() user: RequestUser, @Param('id') id: string) {
    const { tenantId, userId } = identity(user);
    return this.notifications.markRead(tenantId, userId, id);
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead(@User() user: RequestUser) {
    const { tenantId, userId } = identity(user);
    return this.notifications.markAllRead(tenantId, userId);
  }

  @Get('preferences')
  preferences(@User() user: RequestUser) {
    const { tenantId, userId } = identity(user);
    return this.notifications.getPreferences(tenantId, userId);
  }

  @Patch('preferences')
  @HttpCode(200)
  updatePreferences(@User() user: RequestUser, @Req() req: Request) {
    const { tenantId, userId } = identity(user);
    return this.notifications.updatePreferences(tenantId, userId, req.body);
  }

  @Get('stream')
  async stream(
    @User() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<void> {
    if ((process.env.SSE_ENABLED ?? 'true').toLowerCase() === 'false') {
      throw new ServiceUnavailableException({
        code: 'SSE_DISABLED',
        message: 'Live updates are disabled; poll the unread count instead.',
      });
    }

    const { tenantId, userId } = identity(user);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    let unsubscribe: (() => void) | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    let sessionCheck: NodeJS.Timeout | undefined;
    let lifetime: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (sessionCheck) clearInterval(sessionCheck);
      if (lifetime) clearTimeout(lifetime);
      unsubscribe?.();
      const key = connectionKey(tenantId, userId);
      const set = this.connections.get(key);
      if (set) {
        for (const connection of set) {
          if (connection.res === res) set.delete(connection);
        }
        if (set.size === 0) this.connections.delete(key);
      }
      try {
        res.end();
      } catch {
        // The socket may already be gone.
      }
    };

    const send = (event: NotificationStreamEvent) => {
      if (closed) return;
      writeEvent(res, event);
    };

    // Register before the initial work so a notification produced during the
    // replay below is not lost.
    const connection: StreamConnection = { res, close: cleanup };
    const key = connectionKey(tenantId, userId);
    const set = this.connections.get(key) ?? new Set<StreamConnection>();
    this.connections.set(key, set);
    if (set.size >= MAX_CONNECTIONS_PER_USER) {
      const oldest = set.values().next().value as StreamConnection | undefined;
      if (oldest) oldest.close();
    }
    set.add(connection);

    req.on('close', cleanup);
    res.on?.('close', cleanup);

    try {
      const { unreadCount } = await this.notifications.unreadCount(
        tenantId,
        userId,
      );

      send({
        event: 'session',
        data: { action: 'READY', sessionId: user.sid ?? null },
      });
      rawWrite(
        res,
        `event: ready\ndata: ${JSON.stringify({
          unreadCount,
          serverTime: new Date().toISOString(),
        })}\n\n`,
      );

      if (lastEventId) {
        const missed = await this.notifications.replayAfter(
          tenantId,
          userId,
          lastEventId,
        );
        for (const row of missed) {
          send({
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

      unsubscribe = this.bus.subscribe(tenantId, userId, send);

      heartbeat = setInterval(() => {
        if (!closed) rawWrite(res, ': ping\n\n');
      }, HEARTBEAT_MS);

      sessionCheck = setInterval(() => {
        void this.sessionState.assertFresh(user as any).catch(() => {
          send({
            event: 'session',
            data: {
              action: 'REVOKED_ELSEWHERE',
              sessionId: user.sid ?? null,
            },
          });
          cleanup();
        });
      }, SESSION_CHECK_MS);

      lifetime = setTimeout(cleanup, STREAM_LIFETIME_MS);
    } catch (error) {
      cleanup();
      throw error;
    }
  }
}

function identity(user: RequestUser): { tenantId: string; userId: string } {
  const userId = user.id ?? user.sub ?? user.userId ?? '';
  const tenantId = user.tenantId ?? '';
  return { tenantId, userId };
}

function connectionKey(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

function writeEvent(res: Response, event: NotificationStreamEvent): void {
  const lines: string[] = [`event: ${event.event}`];
  if (event.event === 'notification') lines.push(`id: ${event.id}`);
  lines.push(`data: ${JSON.stringify(event.data)}`);
  rawWrite(res, `${lines.join('\n')}\n\n`);
}

function rawWrite(res: Response, chunk: string): void {
  try {
    res.write(chunk);
  } catch {
    // A broken connection is cleaned up by the close handler.
  }
}

// test/notifications/sse.e2e-spec.ts
//
// End-to-end coverage for the Stage 5 notification stream. The app listens on
// an ephemeral port and the test consumes the raw SSE response with Node's
// `http` module, which is the only way to exercise framing, headers and replay
// semantics the browser client depends on.
//
// Covered: stream headers, the `session`/`ready` handshake, per-user isolation,
// `Last-Event-ID` replay and the `SSE_ENABLED=false` fallback.

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import * as http from 'node:http';
import * as request from 'supertest';

import { SessionStateService } from '../../src/auth/services/session-state.service';
import {
  LocalNotificationBus,
  NOTIFICATION_BUS,
} from '../../src/notifications/notification.bus';
import { NotificationsController } from '../../src/notifications/notifications.controller';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  WorkspaceState,
  createFakeWorkspacePrisma,
  emptyWorkspaceState,
} from '../utils/workspace-prisma';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER_A = 'user-alice';
const USER_B = 'user-bob';

const ANCHOR = 'aaaaaaaa-0000-4000-8000-000000000001';
const MISSED = 'aaaaaaaa-0000-4000-8000-000000000002';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000003';

interface SseEvent {
  event: string;
  id?: string;
  data: any;
}

interface Stream {
  status: number;
  headers: http.IncomingHttpHeaders;
  events: SseEvent[];
  waitFor: (
    predicate: (event: SseEvent) => boolean,
    timeoutMs?: number,
  ) => Promise<SseEvent>;
  close: () => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildState(): WorkspaceState {
  return {
    ...emptyWorkspaceState(),
    tenants: [
      {
        id: TENANT,
        tenantId: TENANT,
        slug: 'acme',
        name: 'Acme Corp',
        status: 'ACTIVE',
      },
    ],
    notifications: [
      {
        id: ANCHOR,
        tenantId: TENANT,
        userId: USER_A,
        type: 'SYSTEM',
        title: 'Anchor',
        message: 'Already seen',
        link: null,
        metadata: null,
        dedupeKey: null,
        read: true,
        readAt: new Date(),
        createdAt: new Date(Date.now() - 60_000),
      },
      {
        id: MISSED,
        tenantId: TENANT,
        userId: USER_A,
        type: 'TASK_ASSIGNED',
        title: 'Missed while offline',
        message: 'Replay me',
        link: '/dept/sales/tasks?open=1',
        metadata: { taskId: '1' },
        dedupeKey: null,
        read: false,
        readAt: null,
        createdAt: new Date(Date.now() - 30_000),
      },
      {
        id: OTHER,
        tenantId: TENANT,
        userId: USER_B,
        type: 'SYSTEM',
        title: 'Bob only',
        message: 'Not for Alice',
        link: null,
        metadata: null,
        dedupeKey: null,
        read: false,
        readAt: null,
        createdAt: new Date(Date.now() - 20_000),
      },
    ],
  };
}

describe('Notification stream (Stage 5)', () => {
  let app: INestApplication;
  let state: WorkspaceState;
  let bus: LocalNotificationBus;
  let port: number;

  beforeEach(async () => {
    state = buildState();
    bus = new LocalNotificationBus();
    const prisma = createFakeWorkspacePrisma(state);

    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NOTIFICATION_BUS, useValue: bus },
        {
          provide: SessionStateService,
          useValue: { assertFresh: jest.fn(async () => undefined) },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    (app as any).use((req: any, _res: any, next: any) => {
      const raw = req.headers['x-test-user'];
      if (raw) req.user = JSON.parse(raw);
      next();
    });
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;
    port = address.port;
  });

  afterEach(async () => {
    delete process.env.SSE_ENABLED;
    await app.close();
  });

  const openStream = (userId: string, lastEventId?: string): Promise<Stream> =>
    new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'x-test-user': JSON.stringify({
          id: userId,
          sub: userId,
          tenantId: TENANT,
          sid: `sid-${userId}`,
        }),
      };
      if (lastEventId) headers['last-event-id'] = lastEventId;

      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: '/notifications/stream',
          headers,
        },
        (res) => {
          const events: SseEvent[] = [];
          let buffer = '';
          const waiters: Array<{
            predicate: (event: SseEvent) => boolean;
            resolve: (event: SseEvent) => void;
            reject: (error: Error) => void;
            timer: NodeJS.Timeout;
          }> = [];

          const settle = () => {
            for (let index = waiters.length - 1; index >= 0; index -= 1) {
              const waiter = waiters[index];
              const match = events.find(waiter.predicate);
              if (!match) continue;
              clearTimeout(waiter.timer);
              waiters.splice(index, 1);
              waiter.resolve(match);
            }
          };

          const flush = () => {
            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
              const block = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              boundary = buffer.indexOf('\n\n');

              if (!block || block.startsWith(':')) continue;

              let event = 'message';
              let id: string | undefined;
              const data: string[] = [];
              for (const line of block.split('\n')) {
                if (line.startsWith('event:')) {
                  event = line.slice(6).trim();
                } else if (line.startsWith('id:')) {
                  id = line.slice(3).trim();
                } else if (line.startsWith('data:')) {
                  data.push(line.slice(5).trim());
                }
              }

              let parsed: any = null;
              try {
                parsed = data.length ? JSON.parse(data.join('\n')) : null;
              } catch {
                parsed = data.join('\n');
              }

              events.push({ event, id, data: parsed });
              settle();
            }
          };

          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buffer += chunk;
            flush();
          });
          res.on('error', reject);

          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            events,
            waitFor: (predicate, timeoutMs = 3_000) =>
              new Promise<SseEvent>((waitResolve, waitReject) => {
                const existing = events.find(predicate);
                if (existing) {
                  waitResolve(existing);
                  return;
                }
                const timer = setTimeout(() => {
                  waitReject(new Error('Timed out waiting for an SSE event.'));
                }, timeoutMs);
                waiters.push({
                  predicate,
                  resolve: waitResolve,
                  reject: waitReject,
                  timer,
                });
              }),
            close: () => req.destroy(),
          });
        },
      );

      req.on('error', reject);
    });

  it('opens a framed stream and isolates users', async () => {
    const alice = await openStream(USER_A);
    const bob = await openStream(USER_B);

    try {
      await alice.waitFor((event) => event.event === 'ready');
      await bob.waitFor((event) => event.event === 'ready');

      expect(alice.status).toBe(200);
      expect(alice.headers['content-type']).toContain('text/event-stream');
      expect(alice.headers['cache-control']).toContain('no-cache');
      expect(alice.headers['x-accel-buffering']).toBe('no');
      expect(alice.events[0]).toMatchObject({
        event: 'session',
        data: { action: 'READY' },
      });
      expect(alice.events[1]).toMatchObject({
        event: 'ready',
        data: { unreadCount: 1 },
      });

      bus.publish(TENANT, USER_A, {
        event: 'notification',
        id: 'live-1',
        data: { id: 'live-1', title: 'Hello' },
      });

      const live = await alice.waitFor(
        (event) => event.event === 'notification' && event.id === 'live-1',
      );
      expect(live.data.title).toBe('Hello');

      await delay(150);
      expect(bob.events.some((event) => event.id === 'live-1')).toBe(false);
    } finally {
      alice.close();
      bob.close();
    }
  });

  it('replays notifications after Last-Event-ID for the same user only', async () => {
    const stream = await openStream(USER_A, ANCHOR);

    try {
      await stream.waitFor((event) => event.event === 'ready');
      const replayed = await stream.waitFor(
        (event) => event.event === 'notification',
      );

      expect(replayed.id).toBe(MISSED);
      expect(replayed.data.title).toBe('Missed while offline');

      await delay(100);
      expect(stream.events.some((event) => event.id === OTHER)).toBe(false);
      expect(stream.events.some((event) => event.id === ANCHOR)).toBe(false);
    } finally {
      stream.close();
    }
  });

  it('returns 503 when live updates are disabled', async () => {
    process.env.SSE_ENABLED = 'false';

    const response = await request(app.getHttpServer())
      .get('/notifications/stream')
      .set(
        'x-test-user',
        JSON.stringify({ id: USER_A, tenantId: TENANT, sid: 'sid-a' }),
      );

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('SSE_DISABLED');
  });
});

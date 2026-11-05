import { UnauthorizedException } from '@nestjs/common';
import { NewDeviceNotifier } from './new-device-notifier.service';
import { UserSessionService } from './user-session.service';

interface SessionRow {
  id: string;
  tenantId: string;
  userId: string;
  userAgent: string | null;
  ip: string | null;
  deviceLabel: string | null;
  fingerprint: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function createHarness() {
  const sessions = new Map<string, SessionRow>();
  const notifications: any[] = [];
  const audits: any[] = [];
  let sequence = 0;

  const matches = (row: SessionRow, where: any): boolean => {
    if (typeof where.id === 'string' && row.id !== where.id) return false;
    if (typeof where.id?.not === 'string' && row.id === where.id.not)
      return false;
    if (where.userId !== undefined && row.userId !== where.userId) return false;
    if (where.tenantId !== undefined && row.tenantId !== where.tenantId)
      return false;
    if (
      where.fingerprint !== undefined &&
      row.fingerprint !== where.fingerprint
    )
      return false;
    if (where.revokedAt === null && row.revokedAt !== null) return false;
    if (
      where.expiresAt?.gt !== undefined &&
      row.expiresAt <= where.expiresAt.gt
    )
      return false;
    if (
      where.expiresAt?.lt !== undefined &&
      row.expiresAt >= where.expiresAt.lt
    )
      return false;
    if (
      where.createdAt?.gte !== undefined &&
      row.createdAt < where.createdAt.gte
    )
      return false;
    return true;
  };

  const tx: any = {
    userSession: {
      findFirst: jest.fn(async ({ where }: any) => {
        const found = [...sessions.values()].find((row) => matches(row, where));
        return found ? { id: found.id } : null;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        return sessions.get(where.id) ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...sessions.values()]
          .filter((row) => matches(row, where))
          .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()),
      ),
      create: jest.fn(async ({ data }: any) => {
        sequence += 1;
        const row: SessionRow = {
          id: `session-${sequence}`,
          createdAt: new Date(),
          lastSeenAt: new Date(),
          revokedAt: null,
          revokedReason: null,
          ...data,
        };
        sessions.set(row.id, row);
        return { id: row.id, expiresAt: row.expiresAt };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = [...sessions.values()].filter((row) =>
          matches(row, where),
        );
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const rows = [...sessions.values()].filter((row) =>
          matches(row, where),
        );
        for (const row of rows) sessions.delete(row.id);
        return { count: rows.length };
      }),
    },
    notification: {
      create: jest.fn(async ({ data }: any) => {
        notifications.push(data);
        return data;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        audits.push(data);
        return data;
      }),
    },
    user: {
      update: jest.fn(async () => ({})),
    },
  };

  const prisma: any = {
    withTenant: jest.fn(async (_tenantId: string, fn: any) => fn(tx)),
  };

  const cacheStore = new Map<string, unknown>();
  const cache: any = {
    get: jest.fn(async (key: string) => cacheStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      cacheStore.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      cacheStore.delete(key);
    }),
  };

  const systemPrisma: any = {
    tenant: { findMany: jest.fn(async () => [{ id: 'tenant-1' }]) },
  };

  const sessionState: any = {
    flushUser: jest.fn(async () => undefined),
  };

  const notifier = new NewDeviceNotifier();
  const service = new UserSessionService(
    prisma,
    systemPrisma,
    cache,
    sessionState,
    notifier,
  );

  return {
    service,
    tx,
    sessions,
    notifications,
    audits,
    prisma,
    cache,
    systemPrisma,
    sessionState,
  };
}

const context = {
  ip: '203.0.113.7',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0 Safari/537.36',
  deviceLabel: 'Chrome on Windows',
  fingerprint: 'fingerprint-1',
};

async function seedSession(
  harness: ReturnType<typeof createHarness>,
  overrides: Partial<SessionRow> = {},
): Promise<SessionRow> {
  const session = await harness.tx.userSession.create({
    data: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      userAgent: context.userAgent,
      ip: context.ip,
      deviceLabel: context.deviceLabel,
      fingerprint: context.fingerprint,
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    },
  });
  return harness.sessions.get(session.id)!;
}

describe('UserSessionService', () => {
  it('creates exactly one NEW_DEVICE notification per device', async () => {
    const harness = createHarness();

    const created = await harness.service.create(harness.tx, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      context,
    });
    expect(created.id).toBeDefined();

    await harness.service.create(harness.tx, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      context,
    });

    const newDeviceNotifications = harness.notifications.filter(
      (entry) => entry.type === 'NEW_DEVICE',
    );
    expect(newDeviceNotifications).toHaveLength(1);
  });

  it('rejects missing, revoked, expired and cross-tenant sessions', async () => {
    const harness = createHarness();

    await expect(
      harness.service.assertActive({
        sub: 'user-1',
        tenantId: 'tenant-1',
        sid: 'missing',
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const live = await seedSession(harness);
    await expect(
      harness.service.assertActive({
        sub: 'user-1',
        tenantId: 'tenant-1',
        sid: live.id,
      } as any),
    ).resolves.toBeUndefined();

    const revoked = await seedSession(harness, {
      revokedAt: new Date(),
      fingerprint: 'fingerprint-2',
    });
    await expect(
      harness.service.assertActive({
        sub: 'user-1',
        tenantId: 'tenant-1',
        sid: revoked.id,
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const expired = await seedSession(harness, {
      expiresAt: new Date(Date.now() - 1000),
      fingerprint: 'fingerprint-3',
    });
    await expect(
      harness.service.assertActive({
        sub: 'user-1',
        tenantId: 'tenant-1',
        sid: expired.id,
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const otherTenant = await seedSession(harness, {
      tenantId: 'tenant-2',
      fingerprint: 'fingerprint-4',
    });
    await expect(
      harness.service.assertActive({
        sub: 'user-1',
        tenantId: 'tenant-1',
        sid: otherTenant.id,
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('touches lastSeenAt at most once per five minutes', async () => {
    const harness = createHarness();
    const session = await seedSession(harness);
    const payload = {
      sub: 'user-1',
      tenantId: 'tenant-1',
      sid: session.id,
    } as any;

    await harness.service.assertActive(payload);
    await harness.service.assertActive(payload);

    expect(harness.tx.userSession.updateMany).toHaveBeenCalledTimes(1);
  });

  it('revoke-others keeps the current session alive and audits the revoke', async () => {
    const harness = createHarness();
    const current = await seedSession(harness);
    const otherA = await seedSession(harness, { fingerprint: 'fingerprint-a' });
    const otherB = await seedSession(harness, { fingerprint: 'fingerprint-b' });

    const revoked = await harness.service.revokeOthers(
      'tenant-1',
      'user-1',
      current.id,
    );

    expect(revoked).toBe(2);
    expect(harness.sessions.get(current.id)?.revokedAt).toBeNull();
    expect(harness.sessions.get(otherA.id)?.revokedAt).not.toBeNull();
    expect(harness.sessions.get(otherB.id)?.revokedAt).not.toBeNull();
    expect(harness.audits.at(-1)?.action).toBe('SESSION_REVOKED_OTHERS');
  });

  it('revoke-all bumps sessionVersion and flushes the cached session state', async () => {
    const harness = createHarness();
    const session = await seedSession(harness);

    const revoked = await harness.service.revokeAll('tenant-1', 'user-1');

    expect(revoked).toBe(1);
    expect(harness.sessions.get(session.id)?.revokedAt).not.toBeNull();
    expect(harness.tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { sessionVersion: { increment: 1 } },
    });
    expect(harness.sessionState.flushUser).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
    );
  });

  it('cleanup deletes only sessions expired more than 30 days ago', async () => {
    const harness = createHarness();
    const old = await seedSession(harness, {
      expiresAt: daysAgo(40),
      fingerprint: 'fingerprint-old',
    });
    const recent = await seedSession(harness, {
      expiresAt: daysAgo(10),
      fingerprint: 'fingerprint-recent',
    });
    const live = await seedSession(harness, {
      expiresAt: new Date(Date.now() + 60_000),
      fingerprint: 'fingerprint-live',
    });

    const deleted = await harness.service.cleanupExpiredSessions();

    expect(deleted).toBe(1);
    expect(harness.sessions.has(old.id)).toBe(false);
    expect(harness.sessions.has(recent.id)).toBe(true);
    expect(harness.sessions.has(live.id)).toBe(true);
  });
});

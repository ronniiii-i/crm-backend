// test/session/session.controller.e2e-spec.ts
//
// Contract checks for the personal session API. The controller is exercised
// with a recording service double so the routing/response contract is covered
// without a database.

import { HttpStatus } from '@nestjs/common';
import { SessionController } from '../../src/auth/controllers/session.controller';

const user = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  sid: 'session-current',
};

function createServiceDouble() {
  return {
    list: jest.fn(async () => [
      {
        id: 'session-current',
        current: true,
        deviceLabel: 'Chrome on Windows',
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      },
    ]),
    revokeOthers: jest.fn(async () => 2),
    revokeAll: jest.fn(async () => 3),
    revokeSession: jest.fn(async () => undefined),
  };
}

describe('SessionController', () => {
  it('lists only the caller sessions and marks the current one', async () => {
    const service = createServiceDouble();
    const controller = new SessionController(service as any);

    const result = await controller.list(user);

    expect(service.list).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      'session-current',
    );
    expect(result.currentSessionId).toBe('session-current');
    expect(result.sessions).toHaveLength(1);
  });

  it('never exposes another tenant through the route parameters', async () => {
    const service = createServiceDouble();
    const controller = new SessionController(service as any);

    await controller.list(user);
    await controller.revokeOthers(user);

    // The service receives the authenticated tenant only; there is no tenant
    // input on the route for a caller to tamper with.
    expect(service.list).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      'session-current',
    );
    expect(service.revokeOthers).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      'session-current',
    );
  });

  it('returns 204 when the current session is revoked and a body otherwise', async () => {
    const service = createServiceDouble();
    const controller = new SessionController(service as any);
    const response = { status: jest.fn() };

    const current = await controller.revoke(
      'session-current',
      user,
      response as any,
    );
    expect(current).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(HttpStatus.NO_CONTENT);

    const other = await controller.revoke(
      'session-other',
      user,
      response as any,
    );
    expect(other).toEqual({ revoked: true });
    expect(service.revokeSession).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      'session-other',
      'USER_REVOKE',
    );
  });

  it('returns the number of revoked sessions for revoke-others and revoke-all', async () => {
    const service = createServiceDouble();
    const controller = new SessionController(service as any);

    await expect(controller.revokeOthers(user)).resolves.toEqual({
      revoked: 2,
    });
    await expect(controller.revokeAll(user)).resolves.toEqual({ revoked: 3 });
  });
});

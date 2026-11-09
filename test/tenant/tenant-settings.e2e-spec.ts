// test/tenant/tenant-settings.e2e-spec.ts
//
// Stage 6: workspace preference API. Exercises the real controller/service
// against the in-memory Prisma double:
//   * full settings payload with a derived currency symbol
//   * partial update persists every preference and audits it
//   * invalid timezone/currency/date format return 400

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { PrismaService } from '../../src/prisma/prisma.service';
import { TenantSettingsController } from '../../src/tenant/tenant-settings.controller';
import { TenantSettingsService } from '../../src/tenant/tenant-settings.service';
import {
  WorkspaceState,
  createFakeWorkspacePrisma,
  emptyWorkspaceState,
} from '../utils/workspace-prisma';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ADMIN = { sub: 'user-admin', tenantId: TENANT };

describe('Tenant settings (Stage 6)', () => {
  let app: INestApplication;
  let state: WorkspaceState;

  beforeEach(async () => {
    state = emptyWorkspaceState();
    state.tenants.push({
      id: TENANT,
      tenantId: TENANT,
      name: 'Acme',
      slug: 'acme',
      status: 'ACTIVE',
      currency: 'USD',
      currencySymbol: null,
      dateFormat: 'd MMM yyyy',
      timeZone: 'UTC',
      locale: 'en-US',
      weekStartsOn: 1,
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantSettingsController],
      providers: [
        TenantSettingsService,
        {
          provide: PrismaService,
          useValue: createFakeWorkspacePrisma(state),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.user = ADMIN;
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the full settings payload', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenant/settings')
      .expect(200);

    expect(res.body.settings).toMatchObject({
      name: 'Acme',
      slug: 'acme',
      currency: 'USD',
      dateFormat: 'd MMM yyyy',
      timeZone: 'UTC',
      locale: 'en-US',
      weekStartsOn: 1,
    });
    expect(res.body.settings.currencySymbol).toBe('$');
  });

  it('saves preferences and records an audit row', async () => {
    const res = await request(app.getHttpServer())
      .patch('/tenant/settings')
      .send({
        currency: 'NGN',
        currencySymbol: '₦',
        dateFormat: 'yyyy-MM-dd',
        timeZone: 'Africa/Lagos',
        locale: 'en-NG',
        weekStartsOn: 1,
      })
      .expect(200);

    expect(res.body.settings).toMatchObject({
      currency: 'NGN',
      currencySymbol: '₦',
      dateFormat: 'yyyy-MM-dd',
      timeZone: 'Africa/Lagos',
      locale: 'en-NG',
      weekStartsOn: 1,
    });

    expect(
      state.auditLogs.some((row) => row.action === 'SETTINGS_UPDATE'),
    ).toBe(true);
    expect(state.tenants[0]).toMatchObject({
      currency: 'NGN',
      timeZone: 'Africa/Lagos',
    });
  });

  it.each([
    [{ timeZone: 'Mars/Olympus' }],
    [{ currency: 'BTC' }],
    [{ dateFormat: 'epoch' }],
    [{ weekStartsOn: 9 }],
  ])('rejects invalid settings %j', async (body) => {
    await request(app.getHttpServer())
      .patch('/tenant/settings')
      .send(body)
      .expect(400);

    expect(state.tenants[0].timeZone).toBe('UTC');
  });
});

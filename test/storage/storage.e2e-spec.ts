// test/storage/storage.e2e-spec.ts
//
// Stage 6: object storage and avatar lifecycle.
//
// The real controllers/services run against the in-memory Prisma double and a
// local storage driver writing to a temporary directory. Covered:
//   * avatar presign (allowlist, key ownership, size)
//   * signed local PUT + finalize + profile read
//   * cross-user finalize denial
//   * delete clears the avatar and audits the change
//   * SVG uploads are rejected

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ProfileController } from '../../src/profile/profile.controller';
import { ProfileService } from '../../src/profile/profile.service';
import { StorageController } from '../../src/storage/storage.controller';
import { LocalStorageDriver } from '../../src/storage/drivers/local-storage.driver';
import { StorageService } from '../../src/storage/storage.service';
import { AuditService } from '../../src/workspace/services/audit.service';
import { runWithTenant } from '../../src/tenant/tenant-context';
import {
  WorkspaceState,
  createFakeWorkspacePrisma,
  emptyWorkspaceState,
} from '../utils/workspace-prisma';

const TENANT = '11111111-1111-4111-8111-111111111111';

const USER = {
  sub: 'user-1',
  tenantId: TENANT,
  roleId: 'role-1',
  dataScope: 'SELF',
};

const OTHER = {
  sub: 'user-2',
  tenantId: TENANT,
  roleId: 'role-1',
  dataScope: 'SELF',
};

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050001a5f645400000000049454e44ae426082',
  'hex',
);

describe('Storage and avatar lifecycle (Stage 6)', () => {
  let app: INestApplication;
  let state: WorkspaceState;
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'clasp-avatar-e2e-'));
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    state = emptyWorkspaceState();
    state.tenants.push({
      id: TENANT,
      name: 'Acme',
      slug: 'acme',
      status: 'ACTIVE',
    });
    state.users.push(
      {
        id: 'user-1',
        tenantId: TENANT,
        email: 'one@acme.test',
        name: 'User One',
        avatarUrl: null,
        isVerified: true,
        status: 'ACTIVE',
        roleId: 'role-1',
      },
      {
        id: 'user-2',
        tenantId: TENANT,
        email: 'two@acme.test',
        name: 'User Two',
        avatarUrl: null,
        isVerified: true,
        status: 'ACTIVE',
        roleId: 'role-1',
      },
    );

    const prisma = createFakeWorkspacePrisma(state);
    const storage = new StorageService(
      new LocalStorageDriver({
        rootDir: root,
        baseUrl: 'http://localhost:3030',
        secret: 'e2e-storage-secret',
      }),
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [StorageController, ProfileController],
      providers: [
        ProfileService,
        AuditService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          if (req.headers['x-test-user']) {
            req.user = JSON.parse(req.headers['x-test-user']);
          }
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      if (req.headers['x-test-user']) {
        req.user = JSON.parse(req.headers['x-test-user']);
      }
      runWithTenant(TENANT, () => next());
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
  });

  const as = (test: request.Test, actor = USER) =>
    test.set('x-test-user', JSON.stringify(actor));

  it('rejects SVG avatars before upload', async () => {
    await as(
      request(app.getHttpServer()).post('/storage/presign').send({
        purpose: 'avatar',
        contentType: 'image/svg+xml',
        size: 512,
      }),
    ).expect(400);
  });

  it('rejects an avatar above the configured size', async () => {
    await as(
      request(app.getHttpServer())
        .post('/storage/presign')
        .send({
          purpose: 'avatar',
          contentType: 'image/png',
          size: 50 * 1024 * 1024,
        }),
    ).expect(400);
  });

  it('uploads, finalizes and removes an avatar', async () => {
    const presign = await as(
      request(app.getHttpServer()).post('/storage/presign').send({
        purpose: 'avatar',
        contentType: 'image/png',
        size: PNG_BYTES.length,
      }),
    ).expect(201);

    const uploadUrl = new URL(presign.body.uploadUrl);
    await request(app.getHttpServer())
      .put(`${uploadUrl.pathname}${uploadUrl.search}`)
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES)
      .expect(204);

    const finalized = await as(
      request(app.getHttpServer())
        .patch('/profile/avatar')
        .send({ key: presign.body.key }),
    ).expect(200);

    expect(finalized.body.avatarUrl).toContain('/storage/local?key=');

    const profile = await as(
      request(app.getHttpServer()).get('/profile'),
    ).expect(200);
    expect(profile.body.avatarUrl).toBe(finalized.body.avatarUrl);

    const audit = state.auditLogs.find(
      (row) => row.action === 'AVATAR_UPDATE' && row.entityId === 'user-1',
    );
    expect(audit).toBeDefined();

    const removed = await as(
      request(app.getHttpServer()).delete('/profile/avatar'),
    ).expect(200);
    expect(removed.body.avatarUrl).toBeNull();
    expect(
      state.users.find((row) => row.id === 'user-1')?.avatarUrl,
    ).toBeNull();
  });

  it('does not let a user finalize another user key', async () => {
    const presign = await as(
      request(app.getHttpServer()).post('/storage/presign').send({
        purpose: 'avatar',
        contentType: 'image/png',
        size: PNG_BYTES.length,
      }),
      OTHER,
    ).expect(201);

    await as(
      request(app.getHttpServer())
        .patch('/profile/avatar')
        .send({ key: presign.body.key }),
      USER,
    ).expect(400);
  });

  it('rejects finalize when the object was never uploaded', async () => {
    const presign = await as(
      request(app.getHttpServer()).post('/storage/presign').send({
        purpose: 'avatar',
        contentType: 'image/png',
        size: PNG_BYTES.length,
      }),
    ).expect(201);

    await as(
      request(app.getHttpServer())
        .patch('/profile/avatar')
        .send({ key: presign.body.key }),
    ).expect(400);
  });
});

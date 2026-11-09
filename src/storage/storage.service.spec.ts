import { BadRequestException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalStorageDriver } from './drivers/local-storage.driver';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let root: string;
  let driver: LocalStorageDriver;
  let service: StorageService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'clasp-storage-'));
    driver = new LocalStorageDriver({
      rootDir: root,
      baseUrl: 'http://localhost:3030',
      secret: 'unit-test-storage-secret',
    });
    service = new StorageService(driver);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('presigns an avatar with an opaque tenant/user key', async () => {
    const result = await service.presignUpload({
      tenantId: 'tenant-1',
      userId: 'user-1',
      purpose: 'avatar',
      contentType: 'image/png',
      size: 1024,
    });

    expect(result.key).toMatch(
      /^tenants\/tenant-1\/avatar\/user-1\/[0-9a-f-]+\.png$/,
    );
    expect(result.uploadUrl).toContain('/storage/local/upload?key=');
    expect(result.publicUrl).toContain('/storage/local?key=');
    expect(result.headers['Content-Type']).toBe('image/png');
  });

  it.each(['image/svg+xml', 'text/html', 'application/javascript'])(
    'rejects %s avatars',
    async (contentType) => {
      await expect(
        service.presignUpload({
          tenantId: 'tenant-1',
          userId: 'user-1',
          purpose: 'avatar',
          contentType,
          size: 1024,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('enforces the avatar size limit', async () => {
    const previous = process.env.STORAGE_MAX_AVATAR_BYTES;
    process.env.STORAGE_MAX_AVATAR_BYTES = '1024';
    try {
      await expect(
        service.presignUpload({
          tenantId: 'tenant-1',
          userId: 'user-1',
          purpose: 'avatar',
          contentType: 'image/png',
          size: 2048,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      if (previous === undefined) delete process.env.STORAGE_MAX_AVATAR_BYTES;
      else process.env.STORAGE_MAX_AVATAR_BYTES = previous;
    }
  });

  it('validates avatar key ownership', () => {
    expect(() =>
      service.assertAvatarKey(
        'tenant-1',
        'user-1',
        'tenants/tenant-1/avatar/user-1/abc.png',
      ),
    ).not.toThrow();

    expect(() =>
      service.assertAvatarKey(
        'tenant-1',
        'user-1',
        'tenants/tenant-2/avatar/user-1/abc.png',
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      service.assertAvatarKey(
        'tenant-1',
        'user-1',
        'tenants/tenant-1/avatar/user-2/abc.png',
      ),
    ).toThrow(BadRequestException);
  });

  it('round-trips a local upload through the signed token', async () => {
    const presign = await service.presignUpload({
      tenantId: 'tenant-1',
      userId: 'user-1',
      purpose: 'avatar',
      contentType: 'image/webp',
      size: 4,
    });
    const url = new URL(presign.uploadUrl);
    const token = url.searchParams.get('token') as string;
    const payload = driver.verifyUploadToken(token);

    expect(payload.key).toBe(presign.key);
    await driver.writeUpload(
      payload.key,
      payload.contentType,
      payload.size,
      (async function* () {
        yield Buffer.from([1, 2, 3, 4]);
      })(),
    );

    await expect(service.head(presign.key)).resolves.toEqual({
      contentLength: 4,
      contentType: 'image/webp',
    });

    await service.delete(presign.key);
    await expect(service.head(presign.key)).resolves.toBeNull();
  });

  it('rejects an upload larger than the signed size', async () => {
    const presign = await service.presignUpload({
      tenantId: 'tenant-1',
      userId: 'user-1',
      purpose: 'avatar',
      contentType: 'image/png',
      size: 2,
    });
    const url = new URL(presign.uploadUrl);
    const token = url.searchParams.get('token') as string;
    const payload = driver.verifyUploadToken(token);

    await expect(
      driver.writeUpload(
        payload.key,
        payload.contentType,
        payload.size,
        (async function* () {
          yield Buffer.from([1, 2, 3]);
        })(),
      ),
    ).rejects.toThrow(/larger than declared/);
  });
});

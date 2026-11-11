import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { RegisterAttachmentDto } from '../dto/register-attachment.dto';
import { ResolvedModuleAccess } from '../services/module-access.service';
import { AuditService } from '../services/audit.service';
import { EntityQueryService } from '../services/entity-query.service';
import { AttachmentService } from './attachment.service';

const TENANT = 'tenant-1';
const USER = 'user-1';

function makeAccess(overrides: Partial<ResolvedModuleAccess['actor']> = {}) {
  return {
    actor: {
      id: USER,
      tenantId: TENANT,
      roleId: 'role-1',
      dataScope: 'TENANT',
      departmentId: null,
      managedDepartmentId: null,
      isTenantAdmin: false,
      ...overrides,
    },
    module: { id: 'module-1', key: 'deals' },
    department: null,
    config: {},
    entity: { key: 'deals' },
    actions: ['VIEW', 'CREATE', 'EDIT'],
    scope: 'TENANT',
  } as unknown as ResolvedModuleAccess;
}

function makeDto(
  overrides: Partial<RegisterAttachmentDto> = {},
): RegisterAttachmentDto {
  return {
    key: `tenants/${TENANT}/attachment/${USER}/file-1.pdf`,
    fileName: 'contract.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    ...overrides,
  } as RegisterAttachmentDto;
}

interface Options {
  enabled?: boolean;
  head?: { contentType?: string; contentLength?: number } | null;
  rows?: Record<string, any>[];
  existing?: Record<string, any> | null;
}

function makeHarness(options: Options = {}) {
  const rows = options.rows ?? [];
  const existing = options.existing ?? null;

  const created: Record<string, any> = {
    id: 'attachment-1',
    entity: 'deals',
    entityId: 'deal-1',
    key: `tenants/${TENANT}/attachment/${USER}/file-1.pdf`,
    fileName: 'contract.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    uploadedById: USER,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    uploader: { id: USER, name: 'Ada', email: 'ada@example.test' },
  };

  const tx = {
    attachment: {
      findMany: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue(created),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const prisma = {
    withTenant: jest.fn((_tenantId: string, fn: (client: unknown) => unknown) =>
      Promise.resolve(fn(tx)),
    ),
  } as unknown as PrismaService;

  const queries = {
    requireEntity: jest.fn().mockReturnValue({ key: 'deals' }),
    getOne: jest.fn().mockResolvedValue({ id: 'deal-1' }),
  };

  const storage = {
    attachmentsEnabled: options.enabled ?? true,
    maxAttachmentBytes: 26_214_400,
    assertAttachmentKey: jest.fn(),
    assertAttachmentObject: jest.fn((head: unknown) => {
      if (!head) {
        throw new BadRequestException({
          code: 'ATTACHMENT_OBJECT_MISSING',
          message: 'The uploaded file was not found.',
        });
      }
    }),
    head: jest
      .fn()
      .mockResolvedValue(
        options.head === undefined
          ? { contentType: 'application/pdf', contentLength: 2048 }
          : options.head,
      ),
    signedReadUrl: jest
      .fn()
      .mockImplementation((key: string) =>
        Promise.resolve(`http://localhost/storage/local?key=${key}`),
      ),
    delete: jest.fn().mockResolvedValue(undefined),
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new AttachmentService(
    prisma,
    queries as unknown as EntityQueryService,
    storage as unknown as StorageService,
    audit as unknown as AuditService,
  );

  return { service, tx, storage, audit, queries };
}

describe('AttachmentService', () => {
  it('lists attachments with a signed download URL', async () => {
    const { service, storage } = makeHarness({
      rows: [
        {
          id: 'attachment-1',
          fileName: 'contract.pdf',
          key: 'tenants/t/item.pdf',
          uploadedById: USER,
        },
      ],
    });

    const result = await service.list(makeAccess(), 'deal-1');

    expect(storage.signedReadUrl).toHaveBeenCalledWith('tenants/t/item.pdf');
    expect(result.data[0]).toMatchObject({
      id: 'attachment-1',
      fileName: 'contract.pdf',
      downloadUrl: 'http://localhost/storage/local?key=tenants/t/item.pdf',
    });
  });

  it('registers an uploaded object and audits the change', async () => {
    const { service, storage, audit, tx } = makeHarness();

    const result = await service.create(makeAccess(), 'deal-1', makeDto());

    expect(storage.assertAttachmentKey).toHaveBeenCalledWith(
      TENANT,
      USER,
      makeDto().key,
    );
    expect(tx.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          entity: 'deals',
          entityId: 'deal-1',
          fileName: 'contract.pdf',
          mimeType: 'application/pdf',
          size: 2048,
          uploadedById: USER,
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.objectContaining({ action: 'ATTACHMENT_ADD', entity: 'deals' }),
    );
    expect(result.downloadUrl).toContain('key=');
  });

  it('strips directory segments from a supplied file name', async () => {
    const { service, tx } = makeHarness();

    await service.create(
      makeAccess(),
      'deal-1',
      makeDto({ fileName: '..\\..\\etc\\passwd.pdf' }),
    );

    expect(tx.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fileName: 'passwd.pdf' }),
      }),
    );
  });

  it('uses the stored content type and rejects a declared mismatch', async () => {
    const { service } = makeHarness({
      head: { contentType: 'image/jpeg; charset=binary', contentLength: 2048 },
    });

    await expect(
      service.create(makeAccess(), 'deal-1', makeDto()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an object that exceeds the attachment limit', async () => {
    const { service } = makeHarness({
      head: { contentType: 'application/pdf', contentLength: 30_000_000 },
    });

    await expect(
      service.create(makeAccess(), 'deal-1', makeDto()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an empty attachment', async () => {
    const { service } = makeHarness({
      head: { contentType: 'application/pdf', contentLength: 0 },
    });

    await expect(
      service.create(makeAccess(), 'deal-1', makeDto()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file type outside the attachment allowlist', async () => {
    const { service } = makeHarness({
      head: { contentType: 'text/html', contentLength: 100 },
    });

    await expect(
      service.create(
        makeAccess(),
        'deal-1',
        makeDto({ mimeType: 'text/html' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('soft deletes an attachment and removes the object', async () => {
    const { service, tx, storage, audit } = makeHarness({
      existing: {
        id: 'attachment-1',
        key: 'tenants/t/item.pdf',
        fileName: 'contract.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        uploadedById: USER,
      },
    });

    const result = await service.remove(makeAccess(), 'deal-1', 'attachment-1');

    expect(tx.attachment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attachment-1' },
        data: expect.objectContaining({
          deletedById: USER,
          deletedAt: expect.any(Date),
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      null,
      expect.objectContaining({ action: 'DELETE', entityId: 'deal-1' }),
    );
    expect(storage.delete).toHaveBeenCalledWith('tenants/t/item.pdf');
    expect(result).toEqual({ id: 'attachment-1', deleted: true });
  });

  it("lets a tenant administrator remove someone else's attachment", async () => {
    const { service, storage } = makeHarness({
      existing: {
        id: 'attachment-1',
        key: 'tenants/t/item.pdf',
        uploadedById: 'someone-else',
      },
    });

    await expect(
      service.remove(
        makeAccess({ isTenantAdmin: true }),
        'deal-1',
        'attachment-1',
      ),
    ).resolves.toEqual({ id: 'attachment-1', deleted: true });
    expect(storage.delete).toHaveBeenCalled();
  });

  it("forbids deleting another user's attachment", async () => {
    const { service } = makeHarness({
      existing: {
        id: 'attachment-1',
        key: 'tenants/t/item.pdf',
        uploadedById: 'someone-else',
      },
    });

    await expect(
      service.remove(makeAccess(), 'deal-1', 'attachment-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns not found for an unknown attachment', async () => {
    const { service } = makeHarness({ existing: null });

    await expect(
      service.remove(makeAccess(), 'deal-1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns not found when attachments are disabled', async () => {
    const { service } = makeHarness({ enabled: false });

    await expect(service.list(makeAccess(), 'deal-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

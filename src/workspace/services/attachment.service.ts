import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { isAllowedMimeType } from '../../storage/storage.types';
import { RegisterAttachmentDto } from '../dto/register-attachment.dto';
import { ResolvedModuleAccess } from '../services/module-access.service';
import { AuditService } from '../services/audit.service';
import { EntityQueryService } from '../services/entity-query.service';

interface WriteContext {
  ip?: string;
  userAgent?: string;
}

const ATTACHMENT_SELECT = {
  id: true,
  entity: true,
  entityId: true,
  key: true,
  fileName: true,
  mimeType: true,
  size: true,
  uploadedById: true,
  createdAt: true,
  uploader: { select: { id: true, name: true, email: true } },
} as const;

function normalizeMime(value: string): string {
  return value.split(';')[0].trim().toLowerCase();
}

/** Strip path segments and control characters from a user-supplied name. */
function safeFileName(value: string): string {
  const base = value.split(/[\\/]/).pop() ?? '';
  const cleaned = Array.from(base)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, 255);
  if (!cleaned) {
    throw new BadRequestException({
      code: 'INVALID_FILE_NAME',
      message: 'A file name is required.',
    });
  }
  return cleaned;
}

/**
 * Record attachments for a module record.
 *
 * Bytes are uploaded straight to object storage through a presigned URL; this
 * service only validates the finished object (ownership, type, size) and keeps
 * the soft-deletable metadata row.
 */
@Injectable()
export class AttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: EntityQueryService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async list(access: ResolvedModuleAccess, recordId: string) {
    this.assertEnabled();
    const descriptor = this.queries.requireEntity(access);
    await this.queries.getOne(access, recordId);

    const rows = await this.prisma.withTenant<Record<string, any>[]>(
      access.actor.tenantId,
      (tx) =>
        (tx as any).attachment.findMany({
          where: {
            tenantId: access.actor.tenantId,
            entity: descriptor.key,
            entityId: recordId,
            deletedAt: null,
          },
          select: ATTACHMENT_SELECT,
          orderBy: { createdAt: 'desc' },
        }),
    );

    return {
      data: await Promise.all(
        rows.map((row: Record<string, any>) => this.present(row)),
      ),
    };
  }

  async create(
    access: ResolvedModuleAccess,
    recordId: string,
    dto: RegisterAttachmentDto,
    context: WriteContext = {},
  ) {
    this.assertEnabled();
    const descriptor = this.queries.requireEntity(access);
    await this.queries.getOne(access, recordId);

    const { tenantId } = access.actor;
    this.storage.assertAttachmentKey(tenantId, access.actor.id, dto.key);

    const head = await this.storage.head(dto.key);
    this.storage.assertAttachmentObject(head);

    const declaredMime = normalizeMime(dto.mimeType);
    const storedMime = head.contentType
      ? normalizeMime(head.contentType)
      : declaredMime;

    if (!isAllowedMimeType('attachment', storedMime)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_ATTACHMENT_TYPE',
        message: 'This file type cannot be attached.',
      });
    }
    if (head.contentType && normalizeMime(head.contentType) !== declaredMime) {
      throw new BadRequestException({
        code: 'MIME_MISMATCH',
        message: 'The uploaded file does not match the declared type.',
      });
    }

    const size =
      typeof head.contentLength === 'number' ? head.contentLength : dto.size;
    if (!Number.isFinite(size) || size <= 0) {
      throw new BadRequestException({
        code: 'INVALID_ATTACHMENT_SIZE',
        message: 'The uploaded attachment is empty.',
      });
    }
    if (size > this.storage.maxAttachmentBytes) {
      throw new BadRequestException({
        code: 'ATTACHMENT_TOO_LARGE',
        message: 'The uploaded attachment exceeds the size limit.',
      });
    }

    const fileName = safeFileName(dto.fileName);

    const row = await this.prisma.withTenant<Record<string, any>>(
      tenantId,
      async (tx) => {
        const created = await (tx as any).attachment.create({
          data: {
            tenantId,
            entity: descriptor.key,
            entityId: recordId,
            moduleId: access.module.id,
            key: dto.key,
            fileName,
            mimeType: storedMime,
            size,
            uploadedById: access.actor.id,
          },
          select: ATTACHMENT_SELECT,
        });

        await this.audit.record(tx, null, {
          tenantId,
          departmentId: access.department?.id ?? null,
          actorId: access.actor.id,
          action: 'ATTACHMENT_ADD',
          entity: descriptor.key,
          entityId: recordId,
          after: {
            attachmentId: created.id,
            fileName,
            mimeType: storedMime,
            size,
          },
          ip: context.ip,
          userAgent: context.userAgent,
        });

        return created;
      },
    );

    return this.present(row);
  }

  async remove(
    access: ResolvedModuleAccess,
    recordId: string,
    attachmentId: string,
    context: WriteContext = {},
  ) {
    this.assertEnabled();
    const descriptor = this.queries.requireEntity(access);
    await this.queries.getOne(access, recordId);

    const { tenantId } = access.actor;
    const row = await this.prisma.withTenant<Record<string, any> | null>(
      tenantId,
      (tx) =>
        (tx as any).attachment.findFirst({
          where: {
            id: attachmentId,
            tenantId,
            entity: descriptor.key,
            entityId: recordId,
            deletedAt: null,
          },
          select: ATTACHMENT_SELECT,
        }),
    );

    if (!row) {
      throw new NotFoundException({
        code: 'ATTACHMENT_NOT_FOUND',
        message: 'Attachment was not found.',
      });
    }

    if (row.uploadedById !== access.actor.id && !access.actor.isTenantAdmin) {
      throw new ForbiddenException({
        code: 'ATTACHMENT_DELETE_FORBIDDEN',
        message:
          'Only the uploader or a workspace administrator can remove this attachment.',
      });
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      await (tx as any).attachment.update({
        where: { id: attachmentId },
        data: { deletedAt: new Date(), deletedById: access.actor.id },
      });

      await this.audit.record(tx, null, {
        tenantId,
        departmentId: access.department?.id ?? null,
        actorId: access.actor.id,
        action: 'DELETE',
        entity: descriptor.key,
        entityId: recordId,
        before: {
          attachmentId,
          fileName: row.fileName,
          mimeType: row.mimeType,
          size: row.size,
        },
        after: null,
        ip: context.ip,
        userAgent: context.userAgent,
      });
    });

    // The metadata row is authoritative; object cleanup is best effort.
    await this.storage.delete(row.key).catch(() => undefined);

    return { id: attachmentId, deleted: true };
  }

  private async present(row: Record<string, any>) {
    return {
      ...row,
      downloadUrl: await this.storage.signedReadUrl(row.key),
    };
  }

  private assertEnabled(): void {
    if (!this.storage.attachmentsEnabled) {
      throw new NotFoundException({
        code: 'ATTACHMENTS_DISABLED',
        message: 'Attachments are not enabled for this workspace.',
      });
    }
  }
}

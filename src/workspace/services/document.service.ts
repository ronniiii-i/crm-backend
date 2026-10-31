import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Document,
  DocumentFormat,
  DocumentStatus,
  ModuleType,
  Prisma,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentConfig } from '../types/module-config';
import { WhereInput } from '../types/entity';
import {
  DocumentCreateInput,
  DocumentUpdateInput,
  parseDocumentCreate,
  parseDocumentListQuery,
  parseDocumentUpdate,
} from '../dto/document.dto';
import { AuditService } from './audit.service';
import { ResolvedModuleAccess } from './module-access.service';

const LIST_SELECT = {
  id: true,
  title: true,
  slug: true,
  format: true,
  status: true,
  category: true,
  version: true,
  departmentId: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface DocumentWriteContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Document hub storage.
 *
 * Documents are module-scoped and department-filtered: a member sees global
 * documents (`departmentId = null`) plus their own department's, while tenant
 * admins see everything. Deleting archives by default; a hard delete requires
 * a tenant admin.
 */
@Injectable()
export class DocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(access: ResolvedModuleAccess, rawQuery: Record<string, unknown>) {
    this.assertDocumentModule(access);
    const query = parseDocumentListQuery(rawQuery);
    const where = this.where(access, query);

    return this.prisma.withTenant(access.actor.tenantId, async (tx) => {
      const total = await tx.document.count({ where });
      const rows = await tx.document.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });

      return {
        data: rows,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        },
      };
    });
  }

  async getOne(access: ResolvedModuleAccess, id: string): Promise<Document> {
    this.assertDocumentModule(access);
    this.assertId(id);

    const row = await this.prisma.withTenant(access.actor.tenantId, (tx) =>
      tx.document.findFirst({
        where: { AND: [this.scope(access), { moduleId: access.module.id, id }] },
      }),
    );

    if (!row) throw this.notFound();
    return row;
  }

  async create(
    access: ResolvedModuleAccess,
    body: unknown,
    context: DocumentWriteContext = {},
  ): Promise<Document> {
    this.assertDocumentModule(access);
    const config = access.config as DocumentConfig;
    const input = parseDocumentCreate(body, {
      defaultFormat: config.defaultFormat,
      allowRichText: config.allowRichText,
    });

    return this.prisma.withTenant(access.actor.tenantId, async (tx) => {
      const row = await this.createWithUniqueSlug(tx, access, input);

      await this.audit.record(tx, null, {
        tenantId: access.actor.tenantId,
        departmentId: row.departmentId,
        actorId: access.actor.id,
        action: 'CREATE',
        entity: 'documents',
        entityId: row.id,
        before: null,
        after: row as unknown as Record<string, unknown>,
        ip: context.ip,
        userAgent: context.userAgent,
      });

      return row;
    });
  }

  async update(
    access: ResolvedModuleAccess,
    id: string,
    body: unknown,
    context: DocumentWriteContext = {},
  ): Promise<Document> {
    this.assertDocumentModule(access);
    this.assertId(id);

    const config = access.config as DocumentConfig;
    const patch = parseDocumentUpdate(body, {
      allowRichText: config.allowRichText,
    });

    return this.prisma.withTenant(access.actor.tenantId, async (tx) => {
      const before = await tx.document.findFirst({
        where: { AND: [this.scope(access), { moduleId: access.module.id, id }] },
      });

      if (!before) throw this.notFound();

      const row = await tx.document.update({
        where: { id: before.id },
        data: {
          ...patch,
          version: { increment: 1 },
          updatedById: access.actor.id,
        },
      });

      await this.audit.record(tx, null, {
        tenantId: access.actor.tenantId,
        departmentId: row.departmentId,
        actorId: access.actor.id,
        action: 'UPDATE',
        entity: 'documents',
        entityId: row.id,
        before: before as unknown as Record<string, unknown>,
        after: row as unknown as Record<string, unknown>,
        ip: context.ip,
        userAgent: context.userAgent,
      });

      return row;
    });
  }

  async remove(
    access: ResolvedModuleAccess,
    id: string,
    options: { hard: boolean },
    context: DocumentWriteContext = {},
  ): Promise<{ id: string; archived: boolean; deleted: boolean }> {
    this.assertDocumentModule(access);
    this.assertId(id);

    if (options.hard && !access.actor.isTenantAdmin) {
      throw new ForbiddenException({
        code: 'HARD_DELETE_FORBIDDEN',
        message: 'Only a workspace administrator can permanently delete a document.',
      });
    }

    return this.prisma.withTenant(access.actor.tenantId, async (tx) => {
      const before = await tx.document.findFirst({
        where: { AND: [this.scope(access), { moduleId: access.module.id, id }] },
      });

      if (!before) throw this.notFound();

      let after: Document | null = null;

      if (options.hard) {
        await tx.document.delete({ where: { id: before.id } });
      } else {
        after = await tx.document.update({
          where: { id: before.id },
          data: {
            status: DocumentStatus.ARCHIVED,
            updatedById: access.actor.id,
            version: { increment: 1 },
          },
        });
      }

      await this.audit.record(tx, null, {
        tenantId: access.actor.tenantId,
        departmentId: before.departmentId,
        actorId: access.actor.id,
        action: options.hard ? 'DELETE' : 'ARCHIVE',
        entity: 'documents',
        entityId: before.id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown> | null,
        ip: context.ip,
        userAgent: context.userAgent,
      });

      return {
        id: before.id,
        archived: !options.hard,
        deleted: options.hard,
      };
    });
  }

  private async createWithUniqueSlug(
    tx: Prisma.TransactionClient,
    access: ResolvedModuleAccess,
    input: DocumentCreateInput,
  ): Promise<Document> {
    const base = slugify(input.title);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = `${base}-${randomBytes(3).toString('hex')}`;

      try {
        return await tx.document.create({
          data: {
            tenantId: access.actor.tenantId,
            departmentId: access.actor.isTenantAdmin
              ? null
              : (access.actor.departmentId ?? null),
            moduleId: access.module.id,
            title: input.title,
            slug,
            format: input.format as DocumentFormat,
            status: input.status,
            category: input.category,
            content: input.content,
            createdById: access.actor.id,
          },
        });
      } catch (error) {
        if (
          !(
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          )
        ) {
          throw error;
        }
      }
    }

    throw new BadRequestException({
      code: 'SLUG_CONFLICT',
      message: 'Could not generate a unique document slug. Try a different title.',
    });
  }

  private where(
    access: ResolvedModuleAccess,
    query: ReturnType<typeof parseDocumentListQuery>,
  ): WhereInput {
    const filters: WhereInput[] = [
      this.scope(access),
      { moduleId: access.module.id },
    ];

    if (query.status) {
      filters.push({ status: query.status });
    } else {
      filters.push({ status: { not: DocumentStatus.ARCHIVED } });
    }

    if (query.category) {
      filters.push({ category: query.category });
    }

    if (query.search) {
      filters.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { content: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    return { AND: filters };
  }

  private scope(access: ResolvedModuleAccess): WhereInput {
    if (access.actor.isTenantAdmin) {
      return { tenantId: access.actor.tenantId };
    }

    const departmentId =
      access.actor.departmentId ?? access.actor.managedDepartmentId ?? null;

    return {
      tenantId: access.actor.tenantId,
      OR: departmentId
        ? [{ departmentId: null }, { departmentId }]
        : [{ departmentId: null }],
    };
  }

  private assertDocumentModule(access: ResolvedModuleAccess): void {
    if (access.module.type !== ModuleType.DOCUMENT_HUB) {
      throw new BadRequestException({
        code: 'NOT_A_DOCUMENT_MODULE',
        message: `${access.module.name} is not a document hub.`,
      });
    }
  }

  private assertId(id: string): void {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    ) {
      throw this.notFound();
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'DOCUMENT_NOT_FOUND',
      message: 'Document was not found.',
    });
  }
}

/** Lowercase, hyphenated, ASCII-only slug base. */
export function slugify(value: string): string {
  const base = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return base.length > 0 ? base : 'document';
}

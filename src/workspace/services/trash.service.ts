import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityRegistryService } from './entity-registry.service';
import { AuditService } from './audit.service';
import {
  SOFT_DELETE_ENTITIES,
  SoftDeleteEntity,
  supportsSoftDelete,
} from './soft-delete';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

interface TrashEntityConfig {
  delegate: string;
  /** Module target entity, used to resolve the original module path. */
  targetEntity: string | null;
  /** Columns searched by `q`. */
  searchFields: string[];
  select: Record<string, unknown>;
  label: (row: Record<string, any>) => string;
}

const TRASH_CONFIG: Record<SoftDeleteEntity, TrashEntityConfig> = {
  contacts: {
    delegate: 'contact',
    targetEntity: 'contacts',
    searchFields: ['firstName', 'lastName', 'company', 'email'],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      email: true,
      deletedAt: true,
      deletedById: true,
    },
    label: (row) =>
      [row.firstName, row.lastName].filter(Boolean).join(' ').trim() ||
      row.company ||
      row.email ||
      'Contact',
  },
  deals: {
    delegate: 'deal',
    targetEntity: 'deals',
    searchFields: ['name'],
    select: { id: true, name: true, deletedAt: true, deletedById: true },
    label: (row) => String(row.name ?? 'Deal'),
  },
  invoices: {
    delegate: 'invoice',
    targetEntity: 'invoices',
    searchFields: ['invoiceNumber'],
    select: {
      id: true,
      invoiceNumber: true,
      deletedAt: true,
      deletedById: true,
    },
    label: (row) => `Invoice ${String(row.invoiceNumber ?? '')}`.trim(),
  },
  expenses: {
    delegate: 'expense',
    targetEntity: 'expenses',
    searchFields: ['description', 'category'],
    select: {
      id: true,
      description: true,
      amount: true,
      deletedAt: true,
      deletedById: true,
    },
    label: (row) => String(row.description ?? 'Expense'),
  },
  inventory_items: {
    delegate: 'inventoryItem',
    targetEntity: 'inventory_items',
    searchFields: ['name', 'sku'],
    select: {
      id: true,
      name: true,
      sku: true,
      deletedAt: true,
      deletedById: true,
    },
    label: (row) => String(row.name ?? 'Inventory item'),
  },
  support_tickets: {
    delegate: 'supportTicket',
    targetEntity: 'support_tickets',
    searchFields: ['subject'],
    select: {
      id: true,
      subject: true,
      deletedAt: true,
      deletedById: true,
    },
    label: (row) => String(row.subject ?? 'Support ticket'),
  },
  tasks: {
    delegate: 'task',
    targetEntity: 'tasks',
    searchFields: ['title'],
    select: { id: true, title: true, deletedAt: true, deletedById: true },
    label: (row) => String(row.title ?? 'Task'),
  },
  attendance_records: {
    delegate: 'attendanceRecord',
    targetEntity: 'attendance_records',
    searchFields: ['status'],
    select: {
      id: true,
      date: true,
      status: true,
      deletedAt: true,
      deletedById: true,
    },
    label: (row) =>
      `${row.date ? new Date(row.date).toISOString().slice(0, 10) : 'Attendance'}${row.status ? ` · ${row.status}` : ''}`,
  },
  leave_requests: {
    delegate: 'leaveRequest',
    targetEntity: 'leave_requests',
    searchFields: ['type', 'status', 'reason'],
    select: {
      id: true,
      type: true,
      startDate: true,
      status: true,
      deletedAt: true,
      deletedById: true,
    },
    label: (row) =>
      `${row.type ?? 'Leave'} · ${row.startDate ? new Date(row.startDate).toISOString().slice(0, 10) : ''}`.trim(),
  },
  projects: {
    delegate: 'project',
    targetEntity: 'projects',
    searchFields: ['name'],
    select: { id: true, name: true, deletedAt: true, deletedById: true },
    label: (row) => String(row.name ?? 'Project'),
  },
  documents: {
    delegate: 'document',
    targetEntity: null,
    searchFields: ['title'],
    select: { id: true, title: true, deletedAt: true, deletedById: true },
    label: (row) => String(row.title ?? 'Document'),
  },
};

export interface TrashRow {
  entity: SoftDeleteEntity;
  id: string;
  label: string;
  deletedAt: string | null;
  deletedBy: { id: string; name: string } | null;
  modulePath: string | null;
}

/** Internal row that keeps `deletedById` until user names are hydrated. */
interface RawTrashRow extends TrashRow {
  deletedById: string | null;
}

export interface TrashResult {
  success: true;
  data: TrashRow[];
  counts: Record<string, number>;
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

function firstString(value: unknown): string {
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === 'string' ? value : '';
}

function parsePositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(firstString(value));
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

/**
 * Tenant-admin trash over the soft-delete allowlist.
 *
 * Users, roles, departments, modules and audit rows are deliberately absent:
 * their lifecycle is deactivate/detach/immutable, not delete.
 */
@Injectable()
export class TrashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: EntityRegistryService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    rawQuery: Record<string, unknown>,
  ): Promise<TrashResult> {
    const requested = firstString(rawQuery.entity).trim();
    if (requested && !supportsSoftDelete(requested)) {
      throw new BadRequestException({
        code: 'UNKNOWN_ENTITY',
        message: `"${requested}" is not a trash-eligible entity.`,
      });
    }

    const entities = (
      requested ? [requested as SoftDeleteEntity] : [...SOFT_DELETE_ENTITIES]
    ).slice();
    const query = firstString(rawQuery.q).trim().slice(0, 80);
    const page = parsePositiveInt(rawQuery.page, 1, 10_000);
    const pageSize = parsePositiveInt(
      rawQuery.pageSize,
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    return this.prisma.withTenant(tenantId, async (tx) => {
      const paths = await this.modulePaths(tx, tenantId, entities);

      const counts: Record<string, number> = {};
      const rows: RawTrashRow[] = [];

      for (const entity of entities) {
        const config = TRASH_CONFIG[entity];
        const where = this.whereFor(entity, config, tenantId, query);
        const count = await (tx as any)[config.delegate].count({ where });
        counts[entity] = count;

        if (count === 0) continue;

        // When a single entity is selected we page in the database. For
        // "All" we take a page per entity then merge-sort in memory.
        const skip = requested ? (page - 1) * pageSize : 0;
        const found = await (tx as any)[config.delegate].findMany({
          where,
          select: config.select,
          orderBy: { deletedAt: 'desc' },
          ...(skip > 0 ? { skip } : {}),
          take: pageSize,
        });

        for (const row of found) {
          rows.push({
            entity,
            id: row.id,
            label: config.label(row),
            deletedAt: row.deletedAt
              ? new Date(row.deletedAt).toISOString()
              : null,
            deletedBy: null,
            deletedById: row.deletedById ?? null,
            modulePath: paths.get(entity) ?? null,
          });
        }
      }

      const total = requested
        ? (counts[requested] ?? 0)
        : Object.values(counts).reduce((sum, value) => sum + value, 0);

      rows.sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
      const pageRows = requested
        ? rows
        : rows.slice((page - 1) * pageSize, page * pageSize);

      await this.attachDeleters(tx, tenantId, pageRows);

      return {
        success: true as const,
        data: pageRows.map(({ deletedById, ...row }) => {
          void deletedById;
          return row;
        }),
        counts,
        meta: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      };
    });
  }

  async restore(
    tenantId: string,
    entity: string,
    id: string,
    context: { actorId: string; requestId?: string | null },
  ): Promise<{ success: true; entity: string; id: string }> {
    const config = this.requireEntity(entity);
    this.assertId(id);

    await this.prisma.withTenant(tenantId, async (tx) => {
      const before = await (tx as any)[config.delegate].findFirst({
        where: { id, tenantId, deletedAt: { not: null } },
      });
      if (!before) throw this.notFound(entity);

      try {
        await (tx as any)[config.delegate].update({
          where: { id },
          data: { deletedAt: null, deletedById: null },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException({
            code: 'SOFT_DELETE_RESTORE_CONFLICT',
            message:
              'A live record with the same unique values already exists, so this record cannot be restored.',
          });
        }
        throw error;
      }

      await this.audit.record(tx, this.registry.get(entity) ?? null, {
        tenantId,
        actorId: context.actorId,
        action: 'RESTORE',
        entity,
        entityId: id,
        moduleKey: entity,
        requestId: context.requestId,
        before,
        after: null,
      });
    });

    return { success: true, entity, id };
  }

  async purge(
    tenantId: string,
    entity: string,
    id: string,
    context: { actorId: string; requestId?: string | null },
  ): Promise<{ success: true; entity: string; id: string }> {
    const config = this.requireEntity(entity);
    this.assertId(id);

    await this.prisma.withTenant(tenantId, async (tx) => {
      const before = await (tx as any)[config.delegate].findFirst({
        where: { id, tenantId, deletedAt: { not: null } },
      });
      if (!before) throw this.notFound(entity);

      await (tx as any)[config.delegate].delete({ where: { id } });

      await this.audit.record(tx, this.registry.get(entity) ?? null, {
        tenantId,
        actorId: context.actorId,
        action: 'PURGE',
        entity,
        entityId: id,
        moduleKey: entity,
        requestId: context.requestId,
        before,
        after: null,
      });
    });

    return { success: true, entity, id };
  }

  private whereFor(
    entity: SoftDeleteEntity,
    config: TrashEntityConfig,
    tenantId: string,
    query: string,
  ): Record<string, unknown> {
    const filters: Record<string, unknown>[] = [
      { tenantId },
      { deletedAt: { not: null } },
    ];

    if (query) {
      filters.push({
        OR: config.searchFields.map((field) => ({
          [field]: { contains: query, mode: 'insensitive' },
        })),
      });
    }

    void entity;
    return { AND: filters };
  }

  private async attachDeleters(
    tx: Prisma.TransactionClient,
    tenantId: string,
    rows: RawTrashRow[],
  ): Promise<void> {
    const ids = Array.from(
      new Set(rows.map((row) => row.deletedById).filter(Boolean)),
    ) as string[];

    if (ids.length === 0) return;

    const users = await tx.user.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, name: true },
    });
    const byId = new Map(users.map((user) => [user.id, user.name]));

    for (const row of rows) {
      if (!row.deletedById) continue;
      row.deletedBy = {
        id: row.deletedById,
        name: byId.get(row.deletedById) ?? 'Unknown user',
      };
    }
  }

  private async modulePaths(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entities: SoftDeleteEntity[],
  ): Promise<Map<string, string | null>> {
    const targets = entities
      .map((entity) => TRASH_CONFIG[entity].targetEntity)
      .filter((target): target is string => Boolean(target));

    const modules = await tx.module.findMany({
      where: {
        tenantId,
        OR: [
          ...(targets.length > 0 ? [{ targetEntity: { in: targets } }] : []),
          { type: 'DOCUMENT_HUB' },
        ],
      },
      select: { path: true, targetEntity: true, type: true, isActive: true },
      orderBy: { order: 'asc' },
    });

    const paths = new Map<string, string | null>();
    for (const module of modules) {
      if (!module.isActive) continue;
      if (module.targetEntity) {
        if (!paths.has(module.targetEntity)) {
          paths.set(module.targetEntity, module.path);
        }
      }
      if (module.type === 'DOCUMENT_HUB' && !paths.has('documents')) {
        paths.set('documents', module.path);
      }
    }

    return paths;
  }

  private requireEntity(entity: string): TrashEntityConfig {
    if (!supportsSoftDelete(entity)) {
      throw new BadRequestException({
        code: 'UNKNOWN_ENTITY',
        message: `"${entity}" is not a trash-eligible entity.`,
      });
    }
    return TRASH_CONFIG[entity as SoftDeleteEntity];
  }

  private assertId(id: string): void {
    if (!UUID_PATTERN.test(id)) throw this.notFound('record');
  }

  private notFound(entity: string): NotFoundException {
    return new NotFoundException({
      code: 'RECORD_NOT_FOUND',
      message: `Deleted ${entity} record was not found.`,
    });
  }
}

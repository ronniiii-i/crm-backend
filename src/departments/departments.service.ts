import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleType, PermissionType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import {
  DEPARTMENT_MODULE_TEMPLATE_MAP,
  DepartmentModuleTemplate,
} from '../tenant/department-module-templates';
import { DEFAULT_DEPARTMENTS } from '../tenant/defaults';
import { AuditService } from '../workspace/services/audit.service';

const OVERVIEW_TTL_SECONDS = 60;
const PENDING_LEAVE_STATUSES = ['PENDING_TEAM_LEAD', 'PENDING_HR'] as const;
const TERMINAL_TASK_STATUS = 'Completed';
const ALL_ACTIONS: PermissionType[] = [
  PermissionType.VIEW,
  PermissionType.CREATE,
  PermissionType.EDIT,
  PermissionType.DELETE,
];
const MEMBER_ACTIONS: PermissionType[] = [
  PermissionType.VIEW,
  PermissionType.CREATE,
  PermissionType.EDIT,
];

interface DepartmentWriteContext {
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface DepartmentCounts {
  members: number;
  teams: number;
  modules: number;
  activeModules: number;
  openTasks: number;
  overdueTasks: number;
  pendingLeave: number;
  documents: number;
}

export interface DepartmentOverview {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  manager: { id: string; name: string } | null;
  counts: DepartmentCounts;
  activity: {
    lastAuditAt: string | null;
    openTaskDelta7d: number;
  };
}

export interface OverviewResult {
  success: true;
  departments: DepartmentOverview[];
  unassigned: {
    openTasks: number;
    overdueTasks: number;
    openTaskDelta7d: number;
  };
}

export interface ModuleSummary {
  id: string;
  key: string;
  name: string;
  path: string;
  type: ModuleType;
  targetEntity: string | null;
  departmentId: string | null;
}

export interface ProvisionResult {
  success: true;
  created: ModuleSummary[];
  skipped: string[];
  departmentId: string;
}

function slugifyDepartmentKey(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function normalizeTemplates(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new BadRequestException({
      code: 'INVALID_MODULE_TEMPLATES',
      message: 'moduleTemplates must be an array of template keys.',
    });
  }

  const templates = Array.from(
    new Set(
      raw
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );

  if (templates.length !== raw.filter(Boolean).length) {
    throw new BadRequestException({
      code: 'INVALID_MODULE_TEMPLATES',
      message: 'Every module template must be a non-empty string.',
    });
  }

  for (const key of templates) {
    if (!DEPARTMENT_MODULE_TEMPLATE_MAP.has(key)) {
      throw new BadRequestException({
        code: 'UNKNOWN_MODULE_TEMPLATE',
        message: `"${key}" is not a known department module template.`,
        template: key,
      });
    }
  }

  return templates;
}

function addCount(
  map: Map<string, number>,
  key: string | null | undefined,
  amount: number,
): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every tenant table is guarded by row-level security, so queries must run
   * on a connection where `app.current_tenant` is set. `withTenant` does that
   * and joins an in-flight transaction for the same tenant instead of nesting.
   */
  private scoped<T>(
    tenantId: string,
    fn: (db: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.withTenant(tenantId, fn);
  }

  /**
   * Every workspace is provisioned with the default department catalogue.
   * Tenants created before provisioning existed (or partially rolled back)
   * would otherwise open Settings to an empty list. Seeding only happens when
   * there are no departments at all, so an admin who removes a default isn't
   * surprised by it reappearing on the next request.
   */
  private async ensureDefaults(tenantId: string) {
    await this.scoped(tenantId, async (tx) => {
      const count = await tx.department.count({ where: { tenantId } });
      if (count > 0) return;

      await tx.department.createMany({
        data: DEFAULT_DEPARTMENTS.map((department) => ({
          tenantId,
          key: department.key,
          name: department.name,
          sortOrder: department.sortOrder,
          isSystem: true,
        })),
        skipDuplicates: true,
      });
    });
  }

  async list(tenantId: string) {
    await this.ensureDefaults(tenantId);

    const departments = await this.scoped(tenantId, (tx) =>
      tx.department.findMany({
        where: { tenantId },
        include: {
          manager: { select: { id: true, name: true, email: true } },
          _count: { select: { members: true, Module: true, teams: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    );
    return { success: true, departments };
  }

  /** Department a non-admin may see, or `null` for a tenant administrator. */
  private scopeDepartmentId(user: any): string | null {
    if (user?.isTenantAdmin === true) return null;
    return user?.managedDepartmentId ?? user?.departmentId ?? null;
  }

  /**
   * Aggregated department cards for `/departments`.
   *
   * Counts are grouped per table instead of N+1 per department. Task and leave
   * ownership is derived from the assignee/requester's `departmentId`, which
   * matches how the workspace scope filter associates records.
   */
  async overview(user: any): Promise<OverviewResult> {
    const tenantId = user.tenantId as string;
    await this.ensureDefaults(tenantId);

    const scopedId = this.scopeDepartmentId(user);
    if (!user.isTenantAdmin && !scopedId) {
      return {
        success: true,
        departments: [],
        unassigned: { openTasks: 0, overdueTasks: 0, openTaskDelta7d: 0 },
      };
    }

    const cacheKey = this.cache.tenantKey(
      `departments:overview:${scopedId ?? 'all'}`,
      tenantId,
    );
    const cached = await this.cache.get<OverviewResult>(cacheKey);
    if (cached) return cached;

    const result = await this.scoped(tenantId, async (tx) => {
      const where: Prisma.DepartmentWhereInput = {
        tenantId,
        ...(scopedId ? { id: scopedId } : {}),
      };
      const departments = await tx.department.findMany({
        where,
        include: {
          manager: { select: { id: true, name: true } },
          _count: { select: { members: true, teams: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      if (departments.length === 0) {
        return {
          success: true as const,
          departments: [],
          unassigned: { openTasks: 0, overdueTasks: 0, openTaskDelta7d: 0 },
        };
      }

      const ids = departments.map((department) => department.id);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const now = new Date();

      const [
        modules,
        activeModules,
        openTasks,
        overdueTasks,
        pendingLeave,
        documents,
        audit,
        createdRecent,
        completedRecent,
      ] = await Promise.all([
        tx.module.groupBy({
          by: ['departmentId'],
          where: { tenantId, departmentId: { in: ids } },
          _count: { _all: true },
        }),
        tx.module.groupBy({
          by: ['departmentId'],
          where: { tenantId, departmentId: { in: ids }, isActive: true },
          _count: { _all: true },
        }),
        tx.task.groupBy({
          by: ['assignedToId'],
          where: {
            tenantId,
            deletedAt: null,
            status: { not: TERMINAL_TASK_STATUS },
          },
          _count: { _all: true },
        }),
        tx.task.groupBy({
          by: ['assignedToId'],
          where: {
            tenantId,
            deletedAt: null,
            status: { not: TERMINAL_TASK_STATUS },
            dueDate: { lt: now },
          },
          _count: { _all: true },
        }),
        tx.leaveRequest.groupBy({
          by: ['userId'],
          where: {
            tenantId,
            deletedAt: null,
            status: { in: [...PENDING_LEAVE_STATUSES] },
          },
          _count: { _all: true },
        }),
        tx.document.groupBy({
          by: ['departmentId'],
          where: { tenantId, deletedAt: null },
          _count: { _all: true },
        }),
        tx.auditLog.groupBy({
          by: ['departmentId'],
          where: { tenantId },
          _max: { createdAt: true },
        }),
        tx.task.groupBy({
          by: ['assignedToId'],
          where: {
            tenantId,
            deletedAt: null,
            createdAt: { gte: sevenDaysAgo },
          },
          _count: { _all: true },
        }),
        tx.task.groupBy({
          by: ['assignedToId'],
          where: {
            tenantId,
            deletedAt: null,
            status: TERMINAL_TASK_STATUS,
            updatedAt: { gte: sevenDaysAgo },
          },
          _count: { _all: true },
        }),
      ]);

      const userIds = new Set<string>();
      for (const groups of [
        openTasks,
        overdueTasks,
        pendingLeave,
        createdRecent,
        completedRecent,
      ]) {
        for (const row of groups) {
          const id =
            (row as { assignedToId?: string; userId?: string }).assignedToId ??
            (row as { userId?: string }).userId;
          if (id) userIds.add(id);
        }
      }

      const users = userIds.size
        ? await tx.user.findMany({
            where: { tenantId, id: { in: Array.from(userIds) } },
            select: { id: true, departmentId: true },
          })
        : [];
      const userDepartment = new Map(
        users.map((entry) => [entry.id, entry.departmentId]),
      );

      const moduleCounts = new Map<string, number>();
      for (const row of modules) {
        addCount(moduleCounts, row.departmentId, row._count._all);
      }
      const activeModuleCounts = new Map<string, number>();
      for (const row of activeModules) {
        addCount(activeModuleCounts, row.departmentId, row._count._all);
      }
      const documentCounts = new Map<string, number>();
      for (const row of documents) {
        addCount(documentCounts, row.departmentId, row._count._all);
      }
      const auditAt = new Map<string, Date | null>();
      for (const row of audit) {
        if (row.departmentId) auditAt.set(row.departmentId, row._max.createdAt);
      }

      const openTaskCounts = new Map<string, number>();
      const overdueTaskCounts = new Map<string, number>();
      const pendingLeaveCounts = new Map<string, number>();
      const createdCounts = new Map<string, number>();
      const completedCounts = new Map<string, number>();
      const unassigned = {
        openTasks: 0,
        overdueTasks: 0,
        openTaskDelta7d: 0,
      };

      for (const row of openTasks) {
        const count = row._count._all;
        const departmentId = row.assignedToId
          ? userDepartment.get(row.assignedToId)
          : null;
        if (departmentId) addCount(openTaskCounts, departmentId, count);
        else unassigned.openTasks += count;
      }
      for (const row of overdueTasks) {
        const count = row._count._all;
        const departmentId = row.assignedToId
          ? userDepartment.get(row.assignedToId)
          : null;
        if (departmentId) addCount(overdueTaskCounts, departmentId, count);
        else unassigned.overdueTasks += count;
      }
      for (const row of pendingLeave) {
        const count = row._count._all;
        const departmentId = userDepartment.get(row.userId);
        if (departmentId) addCount(pendingLeaveCounts, departmentId, count);
      }
      for (const row of createdRecent) {
        const count = row._count._all;
        const departmentId = row.assignedToId
          ? userDepartment.get(row.assignedToId)
          : null;
        if (departmentId) addCount(createdCounts, departmentId, count);
        else unassigned.openTaskDelta7d += count;
      }
      for (const row of completedRecent) {
        const count = row._count._all;
        const departmentId = row.assignedToId
          ? userDepartment.get(row.assignedToId)
          : null;
        if (departmentId) addCount(completedCounts, departmentId, -count);
        else unassigned.openTaskDelta7d -= count;
      }

      const data: DepartmentOverview[] = departments.map((department) => ({
        id: department.id,
        key: department.key,
        name: department.name,
        description: department.description ?? null,
        isSystem: department.isSystem,
        manager: department.manager
          ? { id: department.manager.id, name: department.manager.name }
          : null,
        counts: {
          members: department._count.members,
          teams: department._count.teams,
          modules: moduleCounts.get(department.id) ?? 0,
          activeModules: activeModuleCounts.get(department.id) ?? 0,
          openTasks: openTaskCounts.get(department.id) ?? 0,
          overdueTasks: overdueTaskCounts.get(department.id) ?? 0,
          pendingLeave: pendingLeaveCounts.get(department.id) ?? 0,
          documents: documentCounts.get(department.id) ?? 0,
        },
        activity: {
          lastAuditAt: auditAt.get(department.id)?.toISOString() ?? null,
          openTaskDelta7d:
            (createdCounts.get(department.id) ?? 0) +
            (completedCounts.get(department.id) ?? 0),
        },
      }));

      return { success: true as const, departments: data, unassigned };
    });

    await this.cache.set(cacheKey, result, OVERVIEW_TTL_SECONDS);
    return result;
  }

  async summary(user: any, deptId: string) {
    if (!UUID_PATTERN.test(deptId)) {
      throw new NotFoundException('Department not found');
    }
    const scopedId = this.scopeDepartmentId(user);
    if (scopedId && scopedId !== deptId) {
      throw new NotFoundException('Department not found');
    }

    const overview = await this.overview(user);
    const department = overview.departments.find(
      (entry) => entry.id === deptId,
    );
    if (!department) throw new NotFoundException('Department not found');

    return { success: true, department };
  }

  async get(tenantId: string, id: string) {
    const department = await this.scoped(tenantId, (tx) =>
      tx.department.findFirst({
        where: { id, tenantId },
        include: {
          manager: { select: { id: true, name: true, email: true } },
          members: {
            select: { id: true, name: true, email: true, roleId: true },
          },
        },
      }),
    );
    if (!department) throw new NotFoundException('Department not found');
    return { success: true, department };
  }

  /** Pick a key that is not already used in this tenant. */
  private async resolveKey(
    db: Prisma.TransactionClient,
    tenantId: string,
    name: string,
    requested?: string,
  ) {
    const base =
      slugifyDepartmentKey(requested?.trim() || name) || 'department';
    let candidate = base;
    let suffix = 2;

    // `key` is unique per tenant. Try the natural slug first, then suffix it.
    while (
      await db.department.findFirst({
        where: { tenantId, key: candidate },
        select: { id: true },
      })
    ) {
      candidate = `${base}_${suffix++}`;
    }

    return candidate;
  }

  async create(
    tenantId: string,
    dto: any,
    context: DepartmentWriteContext = {},
  ) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Department name is required');
    const templates = normalizeTemplates(dto.moduleTemplates);

    const result = await this.scoped(tenantId, async (tx) => {
      if (dto.managerId) {
        const manager = await tx.user.findFirst({
          where: { id: dto.managerId, tenantId, status: 'ACTIVE' },
        });
        if (!manager)
          throw new BadRequestException({
            code: 'MANAGER_NOT_ACTIVE',
            message: 'Manager must be an active user in this workspace.',
            field: 'managerId',
          });
      }

      if (dto.key) {
        const requested = slugifyDepartmentKey(String(dto.key));
        const existing = await tx.department.findFirst({
          where: { tenantId, key: requested },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException({
            code: 'DEPARTMENT_KEY_TAKEN',
            message: `The key "${requested}" is already in use.`,
            field: 'key',
          });
        }
      }

      const key = await this.resolveKey(tx, tenantId, name, dto.key);

      const department = await tx.department.create({
        data: {
          tenantId,
          name,
          key,
          description: dto.description ?? null,
          managerId: dto.managerId ?? null,
          sortOrder: dto.sortOrder ?? 0,
          isSystem: false,
        },
      });

      const provisioned = templates.length
        ? await this.provisionTemplates(
            tx,
            tenantId,
            department.id,
            department.key,
            department.name,
            templates,
            context,
          )
        : { created: [], skipped: [] };

      return { department, ...provisioned };
    });

    await this.invalidate(tenantId);
    return {
      success: true,
      department: result.department,
      created: result.created,
      skipped: result.skipped,
    };
  }

  async provisionModules(
    tenantId: string,
    deptId: string,
    rawTemplates: unknown,
    context: DepartmentWriteContext = {},
  ): Promise<ProvisionResult> {
    if (!UUID_PATTERN.test(deptId)) {
      throw new NotFoundException('Department not found');
    }
    const templates = normalizeTemplates(rawTemplates);
    if (templates.length === 0) {
      throw new BadRequestException({
        code: 'INVALID_MODULE_TEMPLATES',
        message: 'Select at least one module template.',
      });
    }

    const result = await this.scoped(tenantId, async (tx) => {
      const department = await tx.department.findFirst({
        where: { id: deptId, tenantId },
        select: { id: true, key: true, name: true },
      });
      if (!department) throw new NotFoundException('Department not found');

      const provisioned = await this.provisionTemplates(
        tx,
        tenantId,
        department.id,
        department.key,
        department.name,
        templates,
        context,
      );

      return { departmentId: department.id, ...provisioned };
    });

    await this.invalidate(tenantId);
    return {
      success: true,
      created: result.created,
      skipped: result.skipped,
      departmentId: result.departmentId,
    };
  }

  private async provisionTemplates(
    tx: Prisma.TransactionClient,
    tenantId: string,
    departmentId: string,
    departmentKey: string,
    departmentName: string,
    templates: string[],
    context: DepartmentWriteContext,
  ): Promise<{ created: ModuleSummary[]; skipped: string[] }> {
    const roles = await tx.role.findMany({
      where: { tenantId },
      select: { id: true, slug: true },
    });
    const permissions = await tx.permission.findMany({
      select: { id: true, type: true },
    });
    const permissionId = new Map(
      permissions.map((permission) => [permission.type, permission.id]),
    );

    const maxOrder = await tx.module.aggregate({
      where: { tenantId, departmentId },
      _max: { order: true },
    });
    let nextOrder = (maxOrder._max.order ?? 0) + 1;

    const created: ModuleSummary[] = [];
    const skipped: string[] = [];

    for (const templateKey of templates) {
      const template = DEPARTMENT_MODULE_TEMPLATE_MAP.get(
        templateKey,
      ) as DepartmentModuleTemplate;
      const key = `${departmentKey}-${templateKey}`.slice(0, 60);
      const path = `/dept/${departmentKey}/${key}`;

      const existing = await tx.module.findFirst({
        where: { tenantId, OR: [{ key }, { path }] },
        select: { id: true },
      });
      if (existing) {
        skipped.push(templateKey);
        continue;
      }

      const module = await tx.module.create({
        data: {
          tenantId,
          departmentId,
          key,
          name: template.name,
          path,
          icon: template.icon,
          group: departmentName,
          order: nextOrder++,
          isNavigable: true,
          description: template.description,
          type: template.type,
          targetEntity: template.targetEntity,
          config: template.config(
            departmentKey,
          ) as unknown as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          key: true,
          name: true,
          path: true,
          type: true,
          targetEntity: true,
          departmentId: true,
        },
      });

      const grants: Record<string, PermissionType[]> = {
        tenant_admin: ALL_ACTIONS,
        department_head: ALL_ACTIONS,
        team_lead: MEMBER_ACTIONS,
        staff: MEMBER_ACTIONS,
      };
      const rows: Array<{
        tenantId: string;
        roleId: string;
        moduleId: string;
        permissionId: number;
      }> = [];
      for (const role of roles) {
        const actions = grants[role.slug];
        if (!actions) continue;
        for (const action of actions) {
          const id = permissionId.get(action);
          if (id === undefined) continue;
          rows.push({
            tenantId,
            roleId: role.id,
            moduleId: module.id,
            permissionId: id,
          });
        }
      }
      if (rows.length > 0) {
        await tx.roleModulePermission.createMany({
          data: rows,
          skipDuplicates: true,
        });
      }

      await this.audit.record(tx, null, {
        tenantId,
        departmentId,
        actorId: context.actorId ?? null,
        action: 'PROVISION_MODULES',
        entity: 'modules',
        entityId: module.id,
        moduleKey: module.key,
        requestId: context.requestId,
        after: {
          template: templateKey,
          key: module.key,
          path: module.path,
          type: module.type,
          targetEntity: module.targetEntity,
        },
        ip: context.ip,
        userAgent: context.userAgent,
      });

      created.push(module);
    }

    return { created, skipped };
  }

  async update(tenantId: string, id: string, dto: any) {
    const updated = await this.scoped(tenantId, async (tx) => {
      const department = await tx.department.findFirst({
        where: { id, tenantId },
      });
      if (!department) throw new NotFoundException('Department not found');

      if (dto.managerId) {
        const manager = await tx.user.findFirst({
          where: { id: dto.managerId, tenantId, status: 'ACTIVE' },
        });
        if (!manager)
          throw new BadRequestException('Manager not found in tenant');
      }

      return tx.department.update({
        where: { id },
        data: {
          name: dto.name?.trim() || undefined,
          description: dto.description ?? undefined,
          managerId:
            dto.managerId === null ? null : (dto.managerId ?? undefined),
          sortOrder: dto.sortOrder ?? undefined,
        },
      });
    });

    await this.invalidate(tenantId);
    return { success: true, department: updated };
  }

  async remove(tenantId: string, id: string) {
    await this.scoped(tenantId, async (tx) => {
      const department = await tx.department.findFirst({
        where: { id, tenantId },
        include: {
          _count: {
            select: {
              members: true,
              teams: true,
              expenses: true,
              permissionGroupAssignments: true,
            },
          },
        },
      });
      if (!department) throw new NotFoundException('Department not found');

      // Default (system) departments may be removed by a tenant admin. They are
      // only "system" in the sense that provisioning created them.
      if (
        department._count.members > 0 ||
        department._count.teams > 0 ||
        department._count.expenses > 0
      ) {
        throw new BadRequestException(
          'Department still has members, teams, or expenses linked to it',
        );
      }

      // Modules are navigation entries, not owned records: detach them instead
      // of blocking the delete or cascading them away.
      await tx.module.updateMany({
        where: { tenantId, departmentId: id },
        data: { departmentId: null },
      });
      // Department-scoped permission grants do not survive the department.
      await tx.permissionGroupAssignment.deleteMany({
        where: { tenantId, departmentId: id },
      });
      await tx.department.delete({ where: { id } });
    });

    await this.invalidate(tenantId);
    return { success: true };
  }

  /** Drop ACL and overview caches after a department or module change. */
  async invalidate(tenantId: string): Promise<void> {
    await this.cache.invalidatePattern(
      `tenant:${tenantId}:departments:overview:*`,
    );
    await this.cache.invalidateTenantAcls(tenantId);
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

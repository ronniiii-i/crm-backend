import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, PermissionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { PermissionResolutionService } from '../../auth/services/permission-resolution.service';
import { EmailLinkService } from '../../email/email-link.service';
import { EmailService } from '../../email/email.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { EntityDescriptor, FieldMeta } from '../types/entity';
import { AuditService } from './audit.service';
import { EntityQueryService } from './entity-query.service';
import { ResolvedModuleAccess } from './module-access.service';
import { ScopeFilterService } from './scope-filter.service';
import {
  notDeleted,
  softDeleteEnforced,
  supportsSoftDelete,
  withNotDeleted,
} from './soft-delete';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IMMUTABLE_KEYS = new Set([
  'id',
  'tenantId',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
]);

export interface WriteContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Allowlisted writes for workspace records.
 *
 * Every mutation runs in the same tenant transaction as its audit row, so a
 * failed audit rolls the business change back.
 */
@Injectable()
export class EntityWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queries: EntityQueryService,
    private readonly scopeFilter: ScopeFilterService,
    private readonly permissions: PermissionResolutionService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly email?: EmailService,
    @Optional() private readonly emailLink?: EmailLinkService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  async create(
    access: ResolvedModuleAccess,
    body: Record<string, unknown>,
    context: WriteContext = {},
  ): Promise<unknown> {
    const descriptor = this.queries.requireEntity(access);
    this.assertWritable(descriptor);

    const payload = this.assertPayload(descriptor, body);
    const prepared = this.prepareCreatePayload(descriptor, access, payload);

    const row = await this.prisma.withTenant(
      access.actor.tenantId,
      async (tx) => {
        const data: Record<string, unknown> = {
          ...prepared,
          tenantId: access.actor.tenantId,
        };

        if (descriptor.key === 'tasks' && !data.projectId) {
          data.projectId = await this.resolveDefaultProject(tx, access);
        }

        const row = await (tx as any)[descriptor.delegate].create({
          data,
          select: this.fullSelect(descriptor),
        });

        await this.audit.record(tx, descriptor, {
          tenantId: access.actor.tenantId,
          departmentId: this.auditDepartment(descriptor, row),
          actorId: access.actor.id,
          action: 'CREATE',
          entity: descriptor.key,
          entityId: row.id,
          before: null,
          after: row,
          ip: context.ip,
          userAgent: context.userAgent,
          moduleKey: access.module.key,
          requestId: context.requestId,
        });

        return row;
      },
    );

    await this.notifyTaskAssignment(access, descriptor, row, 'assigned');
    await this.invalidateOverview(access.actor.tenantId);
    return row;
  }

  async update(
    access: ResolvedModuleAccess,
    id: string,
    body: Record<string, unknown>,
    context: WriteContext = {},
  ): Promise<unknown> {
    const descriptor = this.queries.requireEntity(access);
    this.assertWritable(descriptor);
    this.assertId(descriptor, id);

    const payload = this.assertPayload(descriptor, body);
    if (Object.keys(payload).length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_UPDATE',
        message: 'Provide at least one field to update.',
      });
    }

    const data = this.coercePayload(descriptor, payload);
    this.assertAssignable(access, data);

    const scope = await this.scopes(access, descriptor);

    const result = await this.prisma.withTenant(
      access.actor.tenantId,
      async (tx) => {
        const before = await (tx as any)[descriptor.delegate].findFirst({
          where: {
            AND: [
              withNotDeleted(descriptor.key, scope),
              { id },
              notDeleted(descriptor.key),
            ],
          },
          select: this.fullSelect(descriptor),
        });

        if (!before) {
          throw this.notFound(descriptor);
        }

        this.assertSelfEdit(access, descriptor, before, data);

        const row = await (tx as any)[descriptor.delegate].update({
          where: { id },
          data,
          select: this.fullSelect(descriptor),
        });

        await this.audit.record(tx, descriptor, {
          tenantId: access.actor.tenantId,
          departmentId: this.auditDepartment(descriptor, row),
          actorId: access.actor.id,
          action: 'UPDATE',
          entity: descriptor.key,
          entityId: id,
          before,
          after: row,
          ip: context.ip,
          userAgent: context.userAgent,
          moduleKey: access.module.key,
          requestId: context.requestId,
        });

        return { row, before };
      },
    );

    if (result.row.assignedToId !== result.before.assignedToId) {
      await this.notifyTaskAssignment(
        access,
        descriptor,
        result.row,
        'reassigned',
      );
    }

    await this.invalidateOverview(access.actor.tenantId);
    return result.row;
  }

  async remove(
    access: ResolvedModuleAccess,
    id: string,
    context: WriteContext = {},
    options: { hard?: boolean } = {},
  ): Promise<{ id: string; deleted: true; softDeleted?: boolean }> {
    const descriptor = this.queries.requireEntity(access);
    this.assertWritable(descriptor);
    this.assertId(descriptor, id);

    const requestedHard = options.hard === true;
    if (requestedHard && !access.actor.isTenantAdmin) {
      throw new ForbiddenException({
        code: 'TENANT_ADMIN_REQUIRED',
        message: 'Only a workspace administrator can purge a record.',
      });
    }

    const soft =
      supportsSoftDelete(descriptor.key) &&
      softDeleteEnforced() &&
      !requestedHard;
    const scope = await this.scopes(access, descriptor);

    const result = await this.prisma.withTenant<{
      id: string;
      deleted: true;
      softDeleted?: boolean;
    }>(access.actor.tenantId, async (tx) => {
      const before = await (tx as any)[descriptor.delegate].findFirst({
        where: {
          AND: [
            withNotDeleted(descriptor.key, scope),
            { id },
            notDeleted(descriptor.key),
          ],
        },
        select: this.fullSelect(descriptor),
      });

      if (!before) {
        throw this.notFound(descriptor);
      }

      if (access.scope === 'SELF' && !access.actor.isTenantAdmin) {
        throw new ForbiddenException({
          code: 'SELF_DELETE_FORBIDDEN',
          message: `${descriptor.label} cannot be deleted at the SELF scope.`,
          entity: descriptor.key,
        });
      }

      if (soft) {
        await (tx as any)[descriptor.delegate].update({
          where: { id },
          data: {
            deletedAt: new Date(),
            deletedById: access.actor.id,
          },
        });
      } else {
        try {
          await (tx as any)[descriptor.delegate].delete({ where: { id } });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2003'
          ) {
            throw new ConflictException({
              code: 'RECORD_IN_USE',
              message: `${descriptor.label} record is referenced by other records and cannot be deleted.`,
            });
          }
          throw error;
        }
      }

      await this.audit.record(tx, descriptor, {
        tenantId: access.actor.tenantId,
        departmentId: this.auditDepartment(descriptor, before),
        actorId: access.actor.id,
        action: soft ? 'DELETE' : 'PURGE',
        entity: descriptor.key,
        entityId: id,
        moduleKey: access.module.key,
        requestId: context.requestId,
        softDelete: soft,
        before,
        after: null,
        ip: context.ip,
        userAgent: context.userAgent,
      });

      return soft
        ? { id, deleted: true, softDeleted: true }
        : { id, deleted: true };
    });

    await this.invalidateOverview(access.actor.tenantId);
    return result;
  }

  async transition(
    access: ResolvedModuleAccess,
    id: string,
    body: Record<string, unknown>,
    context: WriteContext = {},
  ): Promise<unknown> {
    const descriptor = this.queries.requireEntity(access);
    this.assertWritable(descriptor);
    this.assertId(descriptor, id);

    const statusMeta = descriptor.status;
    if (!statusMeta) {
      throw new BadRequestException({
        code: 'NO_STATUS_FIELD',
        message: `${descriptor.label} has no status field to move.`,
      });
    }

    const status = body?.status;
    if (typeof status !== 'string' || status.length === 0) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: 'A status value is required.',
      });
    }

    const allowed = new Set(statusMeta.values);
    // Kanban modules may declare extra columns (e.g. LOST) in their config.
    const config = access.config as { columns?: Array<{ value?: string }> };
    for (const column of config.columns ?? []) {
      if (column?.value) allowed.add(column.value);
    }

    if (!allowed.has(status)) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: `Status must be one of: ${Array.from(allowed).join(', ')}.`,
      });
    }

    return this.update(
      access,
      id,
      {
        status,
        ...(descriptor.key === 'support_tickets' &&
        ['RESOLVED', 'CLOSED'].includes(status)
          ? { resolvedAt: new Date().toISOString() }
          : {}),
      },
      context,
    );
  }

  /**
   * Reassign a record to another user with an explicit capability check.
   *
   * This is deliberately separate from the generic update so the actor's
   * scope, the target's eligibility, and the target's module visibility are
   * all verified before the owner column changes.
   */
  async reassign(
    access: ResolvedModuleAccess,
    id: string,
    body: Record<string, unknown>,
    context: WriteContext = {},
  ): Promise<unknown> {
    const descriptor = this.queries.requireEntity(access);
    this.assertWritable(descriptor);
    this.assertId(descriptor, id);

    if (!descriptor.reassignable) {
      throw new BadRequestException({
        code: 'REASSIGN_UNSUPPORTED',
        message: `${descriptor.label} cannot be reassigned.`,
      });
    }

    const assignmentField = descriptor.owner.userField ?? descriptor.selfField;
    if (!assignmentField) {
      throw new BadRequestException({
        code: 'REASSIGN_UNSUPPORTED',
        message: `${descriptor.label} has no assignee field.`,
      });
    }

    const targetId = body?.assignedToId;
    if (typeof targetId !== 'string' || !UUID_PATTERN.test(targetId)) {
      throw new BadRequestException({
        code: 'INVALID_ASSIGNEE',
        message: 'A valid assignedToId is required.',
        field: 'assignedToId',
      });
    }

    const actor = access.actor;
    if (
      !actor.isTenantAdmin &&
      !['TENANT', 'DEPARTMENT', 'TEAM'].includes(access.scope)
    ) {
      throw new ForbiddenException({
        code: 'REASSIGN_FORBIDDEN',
        message: `You cannot reassign ${descriptor.label} at the ${access.scope} scope.`,
      });
    }

    const scope = await this.scopes(access, descriptor);

    const result = await this.prisma.withTenant(actor.tenantId, async (tx) => {
      const before = await (tx as any)[descriptor.delegate].findFirst({
        where: {
          AND: [
            withNotDeleted(descriptor.key, scope),
            { id },
            notDeleted(descriptor.key),
          ],
        },
        select: this.fullSelect(descriptor),
      });
      if (!before) throw this.notFound(descriptor);

      const target = await tx.user.findFirst({
        where: { id: targetId, tenantId: actor.tenantId },
        select: {
          id: true,
          name: true,
          email: true,
          departmentId: true,
          roleId: true,
          status: true,
          role: { select: { isTenantAdmin: true } },
        },
      });

      if (!target || (target.status && target.status !== 'ACTIVE')) {
        throw new BadRequestException({
          code: 'TARGET_UNAVAILABLE',
          message:
            'The selected user is not an active member of this workspace.',
        });
      }

      await this.assertTargetInActorScope(tx, access, target);

      const targetIsAdmin = (target.role as any)?.isTenantAdmin === true;
      if (!targetIsAdmin) {
        const effective = await this.permissions.getEffectivePermissions({
          id: target.id,
          role: target.roleId,
          tenantId: actor.tenantId,
          departmentId: target.departmentId ?? null,
          managedDepartmentId: null,
        });
        const canView =
          effective.get(access.module.id)?.has(PermissionType.VIEW) === true;
        if (!canView) {
          throw new BadRequestException({
            code: 'TARGET_NO_ACCESS',
            message:
              'The selected user cannot view this module, so the assignment would be invisible to them.',
          });
        }
      }

      const row = await (tx as any)[descriptor.delegate].update({
        where: { id },
        data: { [assignmentField]: targetId },
        select: this.fullSelect(descriptor),
      });

      await this.audit.record(tx, descriptor, {
        tenantId: actor.tenantId,
        departmentId: this.auditDepartment(descriptor, row),
        actorId: actor.id,
        action: 'REASSIGN',
        entity: descriptor.key,
        entityId: id,
        before,
        after: row,
        ip: context.ip,
        userAgent: context.userAgent,
        moduleKey: access.module.key,
        requestId: context.requestId,
      });

      return { row, before };
    });

    if (result.row.assignedToId !== result.before.assignedToId) {
      await this.notifyTaskAssignment(
        access,
        descriptor,
        result.row,
        'reassigned',
      );
    }

    await this.invalidateOverview(access.actor.tenantId);
    return result.row;
  }

  /** Eligible reassignment targets for the actor's scope and the module. */
  async listAssignees(access: ResolvedModuleAccess) {
    const descriptor = this.queries.requireEntity(access);
    if (!descriptor.reassignable) {
      throw new BadRequestException({
        code: 'REASSIGN_UNSUPPORTED',
        message: `${descriptor.label} cannot be reassigned.`,
      });
    }

    const actor = access.actor;
    const select = {
      id: true,
      name: true,
      email: true,
      departmentId: true,
      roleId: true,
      status: true,
      role: { select: { isTenantAdmin: true } },
    } as const;

    return this.prisma.withTenant(actor.tenantId, async (tx) => {
      let candidates: any[] = [];

      if (actor.isTenantAdmin) {
        candidates = await tx.user.findMany({
          where: { tenantId: actor.tenantId, status: 'ACTIVE' },
          select,
          orderBy: { name: 'asc' },
        });
      } else if (access.scope === 'TEAM') {
        const teamIds = await this.ledTeamIds(tx, actor);
        let memberIds: string[] = [];
        if (teamIds.length > 0) {
          const members = await tx.teamMember.findMany({
            where: { tenantId: actor.tenantId, teamId: { in: teamIds } },
            select: { userId: true },
          });
          memberIds = members.map((member) => member.userId);
        } else if (actor.departmentId) {
          // No led team: fall back to the actor's department.
          const departmentUsers = await tx.user.findMany({
            where: {
              tenantId: actor.tenantId,
              departmentId: actor.departmentId,
            },
            select: { id: true },
          });
          memberIds = departmentUsers.map((user) => user.id);
        }

        candidates = await tx.user.findMany({
          where: {
            tenantId: actor.tenantId,
            status: 'ACTIVE',
            id: { in: Array.from(new Set([actor.id, ...memberIds])) },
          },
          select,
          orderBy: { name: 'asc' },
        });
      } else if (access.scope === 'DEPARTMENT') {
        const departmentId =
          actor.managedDepartmentId ?? actor.departmentId ?? null;
        candidates = departmentId
          ? await tx.user.findMany({
              where: {
                tenantId: actor.tenantId,
                departmentId,
                status: 'ACTIVE',
              },
              select,
              orderBy: { name: 'asc' },
            })
          : [];
      }

      const users: Array<Record<string, unknown>> = [];
      for (const candidate of candidates) {
        if (candidate.role?.isTenantAdmin === true) {
          users.push(candidate);
          continue;
        }

        const effective = await this.permissions.getEffectivePermissions({
          id: candidate.id,
          role: candidate.roleId,
          tenantId: actor.tenantId,
          departmentId: candidate.departmentId ?? null,
          managedDepartmentId: null,
        });
        if (
          effective.get(access.module.id)?.has(PermissionType.VIEW) === true
        ) {
          users.push(candidate);
        }
      }

      return { users };
    });
  }

  // ---------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------

  private async assertTargetInActorScope(
    tx: Prisma.TransactionClient,
    access: ResolvedModuleAccess,
    target: {
      id: string;
      departmentId?: string | null;
    },
  ): Promise<void> {
    const actor = access.actor;
    if (actor.isTenantAdmin) return;

    if (access.scope === 'TEAM') {
      if (target.id === actor.id) return;
      const teamIds = await this.ledTeamIds(tx, actor);
      if (teamIds.length > 0) {
        const membership = await tx.teamMember.findFirst({
          where: {
            tenantId: actor.tenantId,
            userId: target.id,
            teamId: { in: teamIds },
          },
          select: { id: true },
        });
        if (!membership) {
          throw new BadRequestException({
            code: 'TARGET_OUT_OF_TEAM',
            message: 'The selected user is not a member of a team you lead.',
          });
        }
        return;
      }

      if (!actor.departmentId || target.departmentId !== actor.departmentId) {
        throw new BadRequestException({
          code: 'TARGET_OUT_OF_DEPARTMENT',
          message:
            'The selected user is not a member of your team or department.',
        });
      }
      return;
    }

    if (access.scope === 'DEPARTMENT') {
      const departmentId =
        actor.managedDepartmentId ?? actor.departmentId ?? null;
      if (!departmentId || target.departmentId !== departmentId) {
        throw new BadRequestException({
          code: 'TARGET_OUT_OF_DEPARTMENT',
          message: 'The selected user is not a member of your department.',
        });
      }
      return;
    }

    throw new ForbiddenException({
      code: 'REASSIGN_FORBIDDEN',
      message: `You cannot reassign ${access.entity?.label ?? 'records'} at the ${access.scope} scope.`,
    });
  }

  private async ledTeamIds(
    tx: Prisma.TransactionClient,
    actor: ResolvedModuleAccess['actor'],
  ): Promise<string[]> {
    const teams = await tx.team.findMany({
      where: { tenantId: actor.tenantId, leadUserId: actor.id },
      select: { id: true },
    });
    return teams.map((team) => team.id);
  }

  private assertSelfEdit(
    access: ResolvedModuleAccess,
    descriptor: EntityDescriptor,
    before: Record<string, unknown>,
    data: Record<string, unknown>,
  ): void {
    if (access.actor.isTenantAdmin || access.scope !== 'SELF') return;

    if (descriptor.selfCanEdit !== true) {
      throw new ForbiddenException({
        code: 'SELF_EDIT_FORBIDDEN',
        message: `${descriptor.label} cannot be edited at the SELF scope.`,
        entity: descriptor.key,
      });
    }

    const selfField = descriptor.selfField ?? descriptor.owner.userField;
    if (!selfField || before[selfField] !== access.actor.id) {
      throw new ForbiddenException({
        code: 'SELF_EDIT_FORBIDDEN',
        message: `You can only edit ${descriptor.label} records assigned to you.`,
        entity: descriptor.key,
      });
    }

    const allowed = new Set(descriptor.selfEditableFields ?? []);
    for (const key of Object.keys(data)) {
      if (!allowed.has(key)) {
        throw new ForbiddenException({
          code: 'FIELD_FORBIDDEN',
          message: `Field "${key}" cannot be edited at the SELF scope.`,
          field: key,
          entity: descriptor.key,
        });
      }
    }
  }

  private assertWritable(descriptor: EntityDescriptor): void {
    if (descriptor.readOnly) {
      throw new ForbiddenException({
        code: 'ENTITY_READ_ONLY',
        message: `${descriptor.label} are read-only through the workspace API.`,
      });
    }

    if (descriptor.directWritesDenied) {
      throw new ForbiddenException({
        code: 'DIRECT_WRITE_DENIED',
        message: `${descriptor.label} can only be changed through their workflow endpoint.`,
        entity: descriptor.key,
      });
    }
  }

  private assertId(descriptor: EntityDescriptor, id: string): void {
    if (!UUID_PATTERN.test(id)) {
      throw this.notFound(descriptor);
    }
  }

  private assertPayload(
    descriptor: EntityDescriptor,
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException({
        code: 'INVALID_BODY',
        message: 'Request body must be a JSON object.',
      });
    }

    const writable = new Set(
      descriptor.fields
        .filter((field) => field.writable)
        .map((field) => field.name),
    );

    for (const key of Object.keys(body)) {
      if (IMMUTABLE_KEYS.has(key)) {
        throw new BadRequestException({
          code: 'IMMUTABLE_FIELD',
          message: `Field "${key}" cannot be written.`,
        });
      }
      if (!writable.has(key)) {
        throw new BadRequestException({
          code: 'UNKNOWN_FIELD',
          message: `Field "${key}" is not writable for ${descriptor.label}.`,
        });
      }
    }

    return { ...body };
  }

  private prepareCreatePayload(
    descriptor: EntityDescriptor,
    access: ResolvedModuleAccess,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const data = this.coercePayload(descriptor, payload);

    const actor = access.actor;

    switch (descriptor.key) {
      case 'contacts':
        data.userId ??= actor.id;
        data.status ??= 'Lead';
        break;
      case 'invoices':
        data.status ??= 'Pending';
        break;
      case 'expenses':
        data.userId ??= actor.id;
        data.incurredAt ??= new Date().toISOString();
        data.departmentId ??=
          actor.departmentId ?? actor.managedDepartmentId ?? undefined;
        if (!data.departmentId) {
          throw new BadRequestException({
            code: 'MISSING_DEPARTMENT',
            message: 'An expense requires a department.',
          });
        }
        break;
      case 'deals':
        data.userId ??= actor.id;
        data.status ??= 'LEAD';
        break;
      case 'support_tickets':
        data.userId ??= actor.id;
        data.status ??= 'OPEN';
        break;
      case 'tasks':
        data.assignedToId ??= actor.id;
        break;
      case 'inventory_items':
        data.quantity ??= 0;
        data.unit ??= 'pcs';
        data.minStock ??= 5;
        break;
      default:
        break;
    }

    for (const field of descriptor.fields) {
      if (!field.required || field.readOnly) continue;
      if (data[field.name] === undefined || data[field.name] === null) {
        throw new BadRequestException({
          code: 'MISSING_FIELD',
          message: `Field "${field.name}" is required for ${descriptor.label}.`,
          field: field.name,
        });
      }
    }

    this.assertAssignable(access, data);
    return data;
  }

  private coercePayload(
    descriptor: EntityDescriptor,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const byName = new Map(
      descriptor.fields
        .filter((field) => field.writable)
        .map((field) => [field.name, field]),
    );

    for (const [key, value] of Object.entries(payload)) {
      const field = byName.get(key);
      if (!field) continue;

      if (key === 'customFields') {
        result.customFields = normalizeCustomFields(value);
        continue;
      }

      if (value === null) {
        if (field.required) {
          throw new BadRequestException({
            code: 'INVALID_FIELD_VALUE',
            message: `Field "${field.name}" cannot be null.`,
          });
        }
        result[key] = null;
        continue;
      }

      result[key] = coerceWriteValue(field, value);
    }

    return result;
  }

  private assertAssignable(
    access: ResolvedModuleAccess,
    data: Record<string, unknown>,
  ): void {
    const assignmentFields = ['userId', 'assignedToId'];

    for (const field of assignmentFields) {
      const value = data[field];
      if (typeof value !== 'string') continue;
      if (value === access.actor.id) continue;
      if (
        access.actor.isTenantAdmin ||
        ['TENANT', 'DEPARTMENT', 'TEAM'].includes(access.scope)
      ) {
        continue;
      }
      throw new ForbiddenException({
        code: 'ASSIGNMENT_FORBIDDEN',
        message: `You cannot assign records to another user at the ${access.scope} scope.`,
      });
    }
  }

  private async scopes(
    access: ResolvedModuleAccess,
    descriptor: EntityDescriptor,
  ) {
    const scope = await this.scopeFilter.build(
      descriptor,
      access.actor,
      access.module.dataScope,
    );
    return scope.where;
  }

  private fullSelect(descriptor: EntityDescriptor) {
    return {
      ...Object.fromEntries(descriptor.select.map((field) => [field, true])),
      ...descriptor.includeMap,
    };
  }

  private auditDepartment(
    descriptor: EntityDescriptor,
    row: Record<string, unknown> | null,
  ): string | null {
    if (!row) return null;
    const value = row.departmentId;
    if (typeof value === 'string') return value;

    if (descriptor.key === 'expenses' && typeof row.departmentId === 'string') {
      return row.departmentId;
    }

    const relation = row.department as { id?: string } | undefined;
    return relation?.id ?? null;
  }

  private async resolveDefaultProject(
    tx: Prisma.TransactionClient,
    access: ResolvedModuleAccess,
  ): Promise<string> {
    const existing = await tx.project.findFirst({
      where: { tenantId: access.actor.tenantId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing.id;

    const project = await tx.project.create({
      data: {
        name: 'General',
        description: 'Default project for workspace tasks.',
        tenantId: access.actor.tenantId,
        userId: access.actor.id,
      },
      select: { id: true },
    });

    return project.id;
  }

  /**
   * Notify the assignee of a task create/reassign. Runs after the business
   * transaction commits; delivery failures are swallowed by
   * `NotificationsService` so they can never roll back the assignment.
   */
  private async notifyTaskAssignment(
    access: ResolvedModuleAccess,
    descriptor: EntityDescriptor,
    row: Record<string, any>,
    verb: 'assigned' | 'reassigned',
  ): Promise<void> {
    if (descriptor.key !== 'tasks' || !this.notifications) return;

    const assigneeId = row.assignedToId;
    if (typeof assigneeId !== 'string' || assigneeId === access.actor.id) {
      return;
    }

    const taskId = String(row.id);
    const link = `${access.module.path}?open=${encodeURIComponent(taskId)}`;

    let emailPlan:
      | {
          input: {
            to: string;
            assigneeName: string;
            taskTitle: string;
            dueDate: Date | null;
            assignerName: string;
            taskUrl: string;
            tenantId: string;
            idempotencyKey: string;
          };
        }
      | undefined;

    if (this.email && this.emailLink) {
      try {
        const context = await this.prisma.withTenant(
          access.actor.tenantId,
          async (tx) => {
            const [tenant, assignee, actor] = await Promise.all([
              tx.tenant.findUnique({
                where: { id: access.actor.tenantId },
                select: { slug: true },
              }),
              tx.user.findFirst({
                where: { id: assigneeId, tenantId: access.actor.tenantId },
                select: { name: true, email: true },
              }),
              tx.user.findFirst({
                where: { id: access.actor.id, tenantId: access.actor.tenantId },
                select: { name: true },
              }),
            ]);
            return { tenant, assignee, actor };
          },
        );

        if (context.tenant?.slug && context.assignee?.email) {
          emailPlan = {
            input: {
              to: context.assignee.email,
              assigneeName: context.assignee.name,
              taskTitle: String(row.title ?? 'Task'),
              dueDate: row.dueDate ? new Date(row.dueDate) : null,
              assignerName: context.actor?.name ?? 'A teammate',
              taskUrl: this.emailLink.build(
                context.tenant.slug,
                access.module.path,
                { open: taskId },
              ),
              tenantId: access.actor.tenantId,
              idempotencyKey: `task-assigned:${taskId}:${assigneeId}:${
                row.updatedAt instanceof Date
                  ? row.updatedAt.toISOString()
                  : String(row.updatedAt ?? '')
              }`,
            },
          };
        }
      } catch {
        // Best-effort context lookup; in-app delivery still proceeds.
      }
    }

    await this.notifications.notify(
      {
        tenantId: access.actor.tenantId,
        userId: assigneeId,
        type: 'TASK_ASSIGNED',
        title: verb === 'assigned' ? 'New task assigned' : 'Task reassigned',
        message: `You were ${verb} "${String(row.title ?? 'a task')}".`,
        link,
        dedupeKey: `TASK_ASSIGNED:${taskId}:${assigneeId}:${verb}:${
          row.updatedAt instanceof Date
            ? row.updatedAt.toISOString()
            : String(row.updatedAt ?? '')
        }`,
        metadata: { taskId, assignedBy: access.actor.id },
      },
      emailPlan
        ? () => this.email!.send('task-assigned', emailPlan.input)
        : undefined,
    );
  }

  /**
   * Department overview cards embed task, leave and document counts, so any
   * write in a workspace invalidates the cached cards. The pattern invalidation
   * is cheap relative to a write and runs after the transaction commits.
   */
  private async invalidateOverview(tenantId: string): Promise<void> {
    await this.cache?.invalidatePattern(
      `tenant:${tenantId}:departments:overview:*`,
    );
  }

  private notFound(descriptor: EntityDescriptor): NotFoundException {
    return new NotFoundException({
      code: 'RECORD_NOT_FOUND',
      message: `${descriptor.label} record was not found.`,
    });
  }
}

function coerceWriteValue(field: FieldMeta, value: unknown): unknown {
  switch (field.type) {
    case 'number':
    case 'currency': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw invalidValue(field, 'a number');
      }
      return parsed;
    }
    case 'date': {
      const parsed = new Date(String(value));
      if (Number.isNaN(parsed.getTime())) {
        throw invalidValue(field, 'an ISO date');
      }
      return parsed;
    }
    case 'boolean':
      return value === true || value === 'true' || value === '1';
    case 'enum': {
      const stringValue = String(value);
      if (field.enumValues && !field.enumValues.includes(stringValue)) {
        throw new BadRequestException({
          code: 'INVALID_FIELD_VALUE',
          message: `Field "${field.name}" must be one of: ${field.enumValues.join(', ')}.`,
        });
      }
      return stringValue;
    }
    case 'string[]':
      if (
        !Array.isArray(value) ||
        value.some((entry) => typeof entry !== 'string')
      ) {
        throw invalidValue(field, 'an array of strings');
      }
      return value;
    case 'text':
    case 'email': {
      const stringValue = String(value);
      if (stringValue.length > 20000) {
        throw invalidValue(field, 'at most 20000 characters');
      }
      if (
        field.type === 'email' &&
        stringValue.length > 0 &&
        !/^[^@\s]+@[^@\s]+$/.test(stringValue)
      ) {
        throw invalidValue(field, 'a valid email address');
      }
      return stringValue;
    }
    default:
      return value;
  }
}

function invalidValue(
  field: FieldMeta,
  expectation: string,
): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_FIELD_VALUE',
    message: `Field "${field.name}" requires ${expectation}.`,
  });
}

function normalizeCustomFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException({
      code: 'INVALID_CUSTOM_FIELDS',
      message: 'customFields must be a JSON object.',
    });
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 50) {
    throw new BadRequestException({
      code: 'INVALID_CUSTOM_FIELDS',
      message: 'customFields supports at most 50 keys.',
    });
  }

  for (const [key, entry] of entries) {
    const serialized = JSON.stringify(entry);
    if (serialized.length > 2048) {
      throw new BadRequestException({
        code: 'INVALID_CUSTOM_FIELDS',
        message: `customFields.${key} exceeds the 2 KB value limit.`,
      });
    }
    const scalar =
      entry === null ||
      ['string', 'number', 'boolean'].includes(typeof entry) ||
      (Array.isArray(entry) &&
        entry.every((item) =>
          ['string', 'number', 'boolean'].includes(typeof item),
        ));
    if (!scalar) {
      throw new BadRequestException({
        code: 'INVALID_CUSTOM_FIELDS',
        message: `customFields.${key} must be a scalar value or an array of scalars.`,
      });
    }
  }

  return value as Record<string, unknown>;
}

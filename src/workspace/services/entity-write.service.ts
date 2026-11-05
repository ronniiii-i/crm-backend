import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityDescriptor, FieldMeta } from '../types/entity';
import { AuditService } from './audit.service';
import { EntityQueryService } from './entity-query.service';
import { ResolvedModuleAccess } from './module-access.service';
import { ScopeFilterService } from './scope-filter.service';

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

    return this.prisma.withTenant(access.actor.tenantId, async (tx) => {
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
      });

      return row;
    });
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

    return this.prisma.withTenant(access.actor.tenantId, async (tx) => {
      const before = await (tx as any)[descriptor.delegate].findFirst({
        where: { AND: [scope, { id }] },
        select: this.fullSelect(descriptor),
      });

      if (!before) {
        throw this.notFound(descriptor);
      }

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
      });

      return row;
    });
  }

  async remove(
    access: ResolvedModuleAccess,
    id: string,
    context: WriteContext = {},
  ): Promise<{ id: string; deleted: true }> {
    const descriptor = this.queries.requireEntity(access);
    this.assertWritable(descriptor);
    this.assertId(descriptor, id);

    const scope = await this.scopes(access, descriptor);

    return this.prisma.withTenant(access.actor.tenantId, async (tx) => {
      const before = await (tx as any)[descriptor.delegate].findFirst({
        where: { AND: [scope, { id }] },
        select: this.fullSelect(descriptor),
      });

      if (!before) {
        throw this.notFound(descriptor);
      }

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

      await this.audit.record(tx, descriptor, {
        tenantId: access.actor.tenantId,
        departmentId: this.auditDepartment(descriptor, before),
        actorId: access.actor.id,
        action: 'DELETE',
        entity: descriptor.key,
        entityId: id,
        before,
        after: null,
        ip: context.ip,
        userAgent: context.userAgent,
      });

      return { id, deleted: true };
    });
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

  // ---------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------

  private assertWritable(descriptor: EntityDescriptor): void {
    if (descriptor.readOnly) {
      throw new ForbiddenException({
        code: 'ENTITY_READ_ONLY',
        message: `${descriptor.label} are read-only through the workspace API.`,
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

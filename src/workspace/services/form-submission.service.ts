import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ModuleType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FormConfig, FormFieldConfig } from '../types/module-config';
import { WhereInput } from '../types/entity';
import { parseSubmissionBody, submissionInvalid } from '../dto/submission.dto';
import { AuditService } from './audit.service';
import { EntityWriteService, WriteContext } from './entity-write.service';
import { ResolvedModuleAccess } from './module-access.service';
import { ScopeFilterService } from './scope-filter.service';

export interface SubmissionResult {
  submissionId: string;
  entityId?: string;
  status: string;
}

/**
 * Form builder submissions.
 *
 * Values are validated against the module's `FormConfig.fields`, then stored
 * in `form_submissions`. When the form is backed by an entity, column-mapped
 * fields are mirrored into the business record through the allowlisted write
 * service (which also writes its own audit row).
 */
@Injectable()
export class FormSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writes: EntityWriteService,
    private readonly audit: AuditService,
    private readonly scopes: ScopeFilterService,
  ) {}

  async submit(
    access: ResolvedModuleAccess,
    body: unknown,
    context: WriteContext = {},
  ): Promise<SubmissionResult> {
    this.assertFormModule(access);

    const config = access.config as FormConfig;
    const { data } = parseSubmissionBody(body);
    const values = validateValues(config.fields, data);

    let entityId: string | undefined;

    if (config.entity) {
      if (!access.entity || access.entity.key !== config.entity) {
        throw new BadRequestException({
          code: 'FORM_ENTITY_MISMATCH',
          message: `Form entity "${config.entity}" is not writable through this module.`,
        });
      }

      const columnPayload: Record<string, unknown> = {};
      const customFields: Record<string, unknown> = {};

      for (const field of config.fields) {
        const value = values[field.name];
        if (value === undefined) continue;
        if (field.mapTo === 'customFields') {
          customFields[field.name] = value;
        } else {
          columnPayload[field.name] = value;
        }
      }

      if (Object.keys(customFields).length > 0) {
        columnPayload.customFields = customFields;
      }

      const row = (await this.writes.create(
        access,
        columnPayload,
        context,
      )) as { id: string };
      entityId = row.id;
    }

    const submission = await this.prisma.withTenant(
      access.actor.tenantId,
      async (tx) => {
        const created = await tx.formSubmission.create({
          data: {
            tenantId: access.actor.tenantId,
            moduleId: access.module.id,
            entityId: entityId ?? null,
            submittedById: access.actor.id,
            data: values as Prisma.InputJsonValue,
            status: 'SUBMITTED',
          },
        });

        await this.audit.record(tx, null, {
          tenantId: access.actor.tenantId,
          departmentId: access.actor.departmentId ?? null,
          actorId: access.actor.id,
          action: 'SUBMIT',
          entity: 'form_submissions',
          entityId: created.id,
          before: null,
          after: {
            moduleId: access.module.id,
            entityId: entityId ?? null,
            status: created.status,
          },
          ip: context.ip,
          userAgent: context.userAgent,
        });

        return created;
      },
    );

    return {
      submissionId: submission.id,
      ...(entityId ? { entityId } : {}),
      status: submission.status,
    };
  }

  async list(access: ResolvedModuleAccess, rawQuery: Record<string, unknown>) {
    this.assertFormModule(access);

    const page = positiveInt(rawQuery.page, 1, 'page');
    const pageSize = positiveInt(rawQuery.pageSize, 25, 'pageSize');
    if (pageSize > 100) {
      throw new BadRequestException({
        code: 'INVALID_QUERY',
        message: 'pageSize must not exceed 100.',
      });
    }

    const where = await this.buildWhere(access);

    return this.prisma.withTenant(access.actor.tenantId, async (tx) => {
      const total = await tx.formSubmission.count({ where });
      const rows = await tx.formSubmission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          submittedBy: { select: { id: true, name: true, email: true } },
        },
      });

      return {
        data: rows,
        meta: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
        scope: access.scope,
      };
    });
  }

  private async buildWhere(access: ResolvedModuleAccess): Promise<WhereInput> {
    const where: WhereInput = {
      tenantId: access.actor.tenantId,
      moduleId: access.module.id,
    };
    const scope = access.actor.isTenantAdmin ? 'TENANT' : access.scope;

    switch (scope) {
      case 'TENANT':
        return where;

      case 'DEPARTMENT': {
        const departmentId =
          access.actor.managedDepartmentId ?? access.actor.departmentId ?? null;
        if (!departmentId) {
          throw new ForbiddenException({
            code: 'NO_DEPARTMENT',
            message:
              'Your account is not assigned to a department, so department submissions are unavailable.',
          });
        }
        return { ...where, submittedBy: { departmentId } };
      }

      case 'TEAM': {
        const ids = await this.scopes.resolveTeamMemberIds(
          access.actor.tenantId,
          access.actor.id,
        );
        return { ...where, submittedById: { in: ids } };
      }

      case 'SELF':
        return { ...where, submittedById: access.actor.id };
    }
  }

  private assertFormModule(access: ResolvedModuleAccess): void {
    if (access.module.type !== ModuleType.FORM_BUILDER) {
      throw new BadRequestException({
        code: 'NOT_A_FORM_MODULE',
        message: `${access.module.name} is not a form builder module.`,
      });
    }
  }
}

const FIELD_TYPES = new Set([
  'text',
  'textarea',
  'number',
  'currency',
  'date',
  'select',
  'checkbox',
  'email',
]);

/** Validate and coerce submitted values against the form config. */
export function validateValues(
  fields: FormFieldConfig[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const byName = new Map(fields.map((field) => [field.name, field]));

  for (const key of Object.keys(values)) {
    if (!byName.has(key)) {
      throw submissionInvalid(`Field "${key}" is not part of this form.`);
    }
  }

  const result: Record<string, unknown> = {};

  for (const field of fields) {
    if (!FIELD_TYPES.has(field.type)) {
      throw submissionInvalid(`Field "${field.name}" has an unsupported type.`);
    }

    const raw = values[field.name];
    const empty = raw === undefined || raw === null || raw === '';

    if (empty) {
      if (field.required) {
        throw submissionInvalid(`Field "${field.label}" is required.`);
      }
      continue;
    }

    result[field.name] = coerceField(field, raw);
  }

  return result;
}

function coerceField(field: FormFieldConfig, value: unknown): unknown {
  switch (field.type) {
    case 'number':
    case 'currency': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw submissionInvalid(`Field "${field.label}" requires a number.`);
      }
      return parsed;
    }

    case 'date': {
      const parsed = new Date(String(value));
      if (Number.isNaN(parsed.getTime())) {
        throw submissionInvalid(`Field "${field.label}" requires an ISO date.`);
      }
      return parsed.toISOString();
    }

    case 'select': {
      const stringValue = String(value);
      if (field.options && !field.options.includes(stringValue)) {
        throw submissionInvalid(
          `Field "${field.label}" must be one of: ${field.options.join(', ')}.`,
        );
      }
      return stringValue;
    }

    case 'checkbox': {
      if (Array.isArray(value)) {
        if (!value.every((entry) => typeof entry === 'string')) {
          throw submissionInvalid(
            `Field "${field.label}" requires a list of strings.`,
          );
        }
        return value;
      }
      return (
        value === true || value === 'true' || value === 'on' || value === 1
      );
    }

    case 'email': {
      const stringValue = String(value);
      if (!/^[^@\s]+@[^@\s]+$/.test(stringValue)) {
        throw submissionInvalid(
          `Field "${field.label}" requires a valid email.`,
        );
      }
      return stringValue;
    }

    default: {
      const stringValue = String(value);
      if (stringValue.length > 5000) {
        throw submissionInvalid(
          `Field "${field.label}" must be at most 5000 characters.`,
        );
      }
      return stringValue;
    }
  }
}

function positiveInt(value: unknown, fallback: number, name: string): number {
  if (value === undefined || value === null || value === '') return fallback;
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException({
      code: 'INVALID_QUERY',
      message: `${name} must be a positive integer.`,
    });
  }
  return parsed;
}

/** Kept for symmetry with other services; never used for client input. */
export class SubmissionNotFound extends NotFoundException {
  constructor() {
    super({
      code: 'SUBMISSION_NOT_FOUND',
      message: 'Submission was not found.',
    });
  }
}

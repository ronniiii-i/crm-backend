import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EntityDescriptor } from '../types/entity';

export interface AuditRecordParams {
  tenantId: string;
  departmentId?: string | null;
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Writes audit rows inside the business transaction.
 *
 * The audit write is part of the same transaction as the business change, so
 * a failed audit rolls the change back rather than leaving an unaudited
 * mutation behind. `before`/`after` are redacted to the entity allowlist.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  async record(
    tx: Prisma.TransactionClient,
    descriptor: EntityDescriptor | null,
    params: AuditRecordParams,
  ): Promise<void> {
    try {
      await tx.auditLog.create({
        data: {
          tenantId: params.tenantId,
          departmentId: params.departmentId ?? null,
          actorId: params.actorId ?? null,
          action: params.action,
          entity: params.entity,
          entityId: params.entityId ?? null,
          before: redact(descriptor, params.before) as Prisma.InputJsonValue,
          after: redact(descriptor, params.after) as Prisma.InputJsonValue,
          ip: params.ip ?? null,
          userAgent: params.userAgent ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Audit write failed for ${params.entity}:${params.entityId ?? '-'} (${params.action})`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}

/** Keep only allowlisted, non-secret fields in audit snapshots. */
function redact(
  descriptor: EntityDescriptor | null,
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;

  if (!descriptor) {
    return { ...value };
  }

  const allowed = new Set(descriptor.select);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (allowed.has(key) && key !== 'id') {
      result[key] = entry;
    }
  }
  return result;
}

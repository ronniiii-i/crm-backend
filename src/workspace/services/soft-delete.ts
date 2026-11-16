import { WhereInput } from '../types/entity';

/**
 * Entities that use `deletedAt`/`deletedById` instead of a hard delete.
 *
 * This is an explicit allowlist rather than the descriptor's `softDelete`
 * flag because some read-only descriptors (notably `projects`) still carry
 * the columns, while `users`, `departments` and `audit_logs` must never be
 * hidden by a soft-delete filter.
 */
export const SOFT_DELETE_ENTITIES = [
  'contacts',
  'deals',
  'invoices',
  'expenses',
  'inventory_items',
  'support_tickets',
  'tasks',
  'attendance_records',
  'leave_requests',
  'projects',
  'documents',
] as const;

export type SoftDeleteEntity = (typeof SOFT_DELETE_ENTITIES)[number];

const SOFT_DELETE_SET: ReadonlySet<string> = new Set(SOFT_DELETE_ENTITIES);

export function supportsSoftDelete(entity: string): boolean {
  return SOFT_DELETE_SET.has(entity);
}

/** Predicate that excludes soft-deleted rows; empty for other entities. */
export function notDeleted(entity: string): WhereInput {
  return supportsSoftDelete(entity) ? { deletedAt: null } : {};
}

/** Apply the soft-delete predicate to an existing where fragment. */
export function withNotDeleted(entity: string, where: WhereInput): WhereInput {
  if (!supportsSoftDelete(entity)) return where;
  return { AND: [where, { deletedAt: null }] };
}

/**
 * Only rows that are actually in the trash. Used by restore/purge so an
 * admin cannot purge a live record through the trash endpoints.
 */
export function onlyDeleted(entity: string): WhereInput {
  return supportsSoftDelete(entity) ? { deletedAt: { not: null } } : {};
}

/** Whether soft delete is enforced. `false` is the emergency rollback path. */
export function softDeleteEnforced(): boolean {
  return (process.env.SOFT_DELETE_ENFORCE ?? 'true').trim() !== 'false';
}

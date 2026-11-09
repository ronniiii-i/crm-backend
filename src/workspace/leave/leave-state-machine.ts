/**
 * Leave approval state machine.
 *
 * The table is deliberately declarative (and free of Nest/Prisma imports) so
 * it can be unit-tested as a truth table:
 *
 *   from              action   to
 *   PENDING_TEAM_LEAD APPROVE  PENDING_HR
 *   PENDING_TEAM_LEAD REJECT   REJECTED
 *   PENDING_TEAM_LEAD CANCEL   CANCELLED
 *   PENDING_HR        APPROVE  APPROVED
 *   PENDING_HR        REJECT   REJECTED
 *   PENDING_HR        CANCEL   CANCELLED
 *
 * Terminal states are immutable: every action returns `null`.
 */

export type LeaveAction = 'APPROVE' | 'REJECT' | 'CANCEL';

export type LeaveStatus =
  | 'PENDING_TEAM_LEAD'
  | 'PENDING_HR'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export type PendingLeaveStatus = 'PENDING_TEAM_LEAD' | 'PENDING_HR';

export interface LeaveTransition {
  from: PendingLeaveStatus;
  action: LeaveAction;
  to: LeaveStatus;
  /** Stage recorded on the request after the transition. */
  stage: number;
  /** Terminal transitions cannot be acted on again. */
  terminal: boolean;
}

const TRANSITIONS: Record<
  PendingLeaveStatus,
  Record<LeaveAction, LeaveTransition>
> = {
  PENDING_TEAM_LEAD: {
    APPROVE: {
      from: 'PENDING_TEAM_LEAD',
      action: 'APPROVE',
      to: 'PENDING_HR',
      stage: 2,
      terminal: false,
    },
    REJECT: {
      from: 'PENDING_TEAM_LEAD',
      action: 'REJECT',
      to: 'REJECTED',
      stage: 1,
      terminal: true,
    },
    CANCEL: {
      from: 'PENDING_TEAM_LEAD',
      action: 'CANCEL',
      to: 'CANCELLED',
      stage: 1,
      terminal: true,
    },
  },
  PENDING_HR: {
    APPROVE: {
      from: 'PENDING_HR',
      action: 'APPROVE',
      to: 'APPROVED',
      stage: 2,
      terminal: true,
    },
    REJECT: {
      from: 'PENDING_HR',
      action: 'REJECT',
      to: 'REJECTED',
      stage: 2,
      terminal: true,
    },
    CANCEL: {
      from: 'PENDING_HR',
      action: 'CANCEL',
      to: 'CANCELLED',
      stage: 2,
      terminal: true,
    },
  },
};

export function isPendingStatus(status: string): status is PendingLeaveStatus {
  return status === 'PENDING_TEAM_LEAD' || status === 'PENDING_HR';
}

export function isTerminalStatus(status: string): boolean {
  return (
    status === 'APPROVED' || status === 'REJECTED' || status === 'CANCELLED'
  );
}

export function isLeaveAction(value: unknown): value is LeaveAction {
  return value === 'APPROVE' || value === 'REJECT' || value === 'CANCEL';
}

/** Resolve the transition, or `null` when the move is not legal. */
export function transitionFor(
  status: string,
  action: LeaveAction,
): LeaveTransition | null {
  if (!isPendingStatus(status)) return null;
  return TRANSITIONS[status][action] ?? null;
}

/**
 * Which approver capabilities may act at a stage.
 *
 * A Team Lead and the requester's HOD can both act at the first stage; HR is
 * reserved for the second stage. Tenant Admin override is handled separately.
 */
export function allowedApproverRoles(
  status: string,
): Array<'TEAM_LEAD' | 'HOD' | 'HR'> {
  if (status === 'PENDING_TEAM_LEAD') return ['TEAM_LEAD', 'HOD'];
  if (status === 'PENDING_HR') return ['HR'];
  return [];
}

export interface ApproverContext {
  actorId: string;
  requesterId: string;
  teamLeadId: string | null;
  hodId: string | null;
  hrApproverId: string | null;
  isTenantAdmin: boolean;
}

export type ApproverCheck =
  | { allowed: true; override: boolean }
  | { allowed: false; reason: 'SELF_APPROVAL' | 'NOT_APPROVER' };

/**
 * Decide whether the actor may approve or reject at the current stage.
 *
 * Self-approval is always denied unless the actor is an explicit Tenant Admin;
 * the caller records `override: true` in that case.
 */
export function checkApprover(
  status: string,
  context: ApproverContext,
): ApproverCheck {
  if (context.actorId === context.requesterId) {
    if (context.isTenantAdmin) return { allowed: true, override: true };
    return { allowed: false, reason: 'SELF_APPROVAL' };
  }

  if (context.isTenantAdmin) return { allowed: true, override: true };

  const roles = allowedApproverRoles(status);
  for (const role of roles) {
    if (role === 'TEAM_LEAD' && context.teamLeadId === context.actorId) {
      return { allowed: true, override: false };
    }
    if (role === 'HOD' && context.hodId === context.actorId) {
      return { allowed: true, override: false };
    }
    if (role === 'HR' && context.hrApproverId === context.actorId) {
      return { allowed: true, override: false };
    }
  }

  return { allowed: false, reason: 'NOT_APPROVER' };
}

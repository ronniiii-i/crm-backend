import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { LeaveType, Prisma } from '@prisma/client';

import { EmailLinkService } from '../../email/email-link.service';
import { EmailService } from '../../email/email.service';
import type {
  LeaveDecisionEmailInput,
  LeaveSubmittedEmailInput,
} from '../../email/email.types';
import { NotificationsService } from '../../notifications/notifications.service';
import type { CreateNotificationInput } from '../../notifications/notification.types';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../cache/cache.service';
import { WorkflowConfig } from '../types/module-config';
import {
  eachWorkingDay,
  isPastDate,
  parseLeaveDate,
  workingDays,
} from '../leave/leave-rules';
import {
  ApproverCheck,
  LeaveAction,
  checkApprover,
  isLeaveAction,
  isTerminalStatus,
  transitionFor,
} from '../leave/leave-state-machine';
import { AuditService } from './audit.service';
import { EntityRegistryService } from './entity-registry.service';
import { ResolvedModuleAccess } from './module-access.service';
import { ScopeFilterService } from './scope-filter.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEAVE_TYPES = [
  'ANNUAL',
  'SICK',
  'CASUAL',
  'UNPAID',
  'PARENTAL',
  'OTHER',
] as const;

const REQUESTER_FIELDS = ['type', 'startDate', 'endDate', 'reason'];

const MAX_REASON_LENGTH = 2000;
const MAX_NOTE_LENGTH = 2000;

const LEAVE_INCLUDE = {
  user: { select: { id: true, name: true, email: true, departmentId: true } },
  teamLead: { select: { id: true, name: true, email: true } },
  hod: { select: { id: true, name: true, email: true } },
  hrApprover: { select: { id: true, name: true, email: true } },
  decidedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.LeaveRequestInclude;

export interface LeaveWriteContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

interface LeaveUser {
  id: string;
  name: string;
  email: string;
  departmentId?: string | null;
}

interface ResolvedApprovers {
  teamLeadId: string | null;
  hodId: string | null;
  hrApproverId: string | null;
  status: 'PENDING_TEAM_LEAD' | 'PENDING_HR';
  currentStage: number;
}

type LeaveEmailPlan =
  | { template: 'leave-submitted'; input: LeaveSubmittedEmailInput }
  | { template: 'leave-decision'; input: LeaveDecisionEmailInput };

interface NotificationPlan {
  notification: CreateNotificationInput;
  email?: LeaveEmailPlan;
  leaveEvent?: { userId: string; data: Record<string, unknown> };
}

interface TransitionOutcome {
  row: Record<string, unknown>;
  plans: NotificationPlan[];
  override: boolean;
}

/**
 * Leave approval workflow.
 *
 * `leave_requests` is deliberately excluded from generic writes: every
 * mutation goes through this service so approver resolution, the state
 * machine, attendance materialisation, audit rows and notifications cannot be
 * bypassed by a `PATCH`.
 */
@Injectable()
export class LeaveWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registry: EntityRegistryService,
    private readonly scopes: ScopeFilterService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly email?: EmailService,
    @Optional() private readonly emailLink?: EmailLinkService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  async create(
    access: ResolvedModuleAccess,
    body: Record<string, unknown>,
    context: LeaveWriteContext = {},
  ): Promise<unknown> {
    const config = this.assertWorkflow(access);
    const payload = this.validateCreate(access, body, config);

    const result = await this.prisma.withTenant(
      access.actor.tenantId,
      async (tx) => {
        const requester = await this.loadUser(
          tx,
          access.actor.tenantId,
          access.actor.id,
        );
        if (!requester) throw this.notFound();

        const approvers = await this.resolveApprovers(
          tx,
          access.actor.tenantId,
          requester,
        );

        const overlap = await tx.leaveRequest.findFirst({
          where: {
            tenantId: access.actor.tenantId,
            userId: requester.id,
            deletedAt: null,
            status: {
              in: ['PENDING_TEAM_LEAD', 'PENDING_HR', 'APPROVED'],
            },
            startDate: { lte: payload.endDate },
            endDate: { gte: payload.startDate },
          },
          select: { id: true },
        });

        if (overlap) {
          throw new ConflictException({
            code: 'LEAVE_OVERLAP',
            message:
              'This request overlaps an existing pending or approved leave request.',
          });
        }

        const created = await tx.leaveRequest.create({
          data: {
            tenantId: access.actor.tenantId,
            userId: requester.id,
            type: payload.type as LeaveType,
            startDate: payload.startDate,
            endDate: payload.endDate,
            days: payload.days,
            reason: payload.reason,
            status: approvers.status,
            currentStage: approvers.currentStage,
            teamLeadId: approvers.teamLeadId,
            hodId: approvers.hodId,
            hrApproverId: approvers.hrApproverId,
            submittedAt: new Date(),
          },
          include: LEAVE_INCLUDE,
        });

        await this.audit.record(tx, null, {
          tenantId: access.actor.tenantId,
          departmentId: requester.departmentId ?? null,
          actorId: access.actor.id,
          action: 'SUBMIT',
          entity: 'leave_requests',
          entityId: created.id,
          moduleKey: access.module.key,
          requestId: context.requestId ?? null,
          before: null,
          after: created as unknown as Record<string, unknown>,
          ip: context.ip,
          userAgent: context.userAgent,
        });

        const users = await this.loadUsers(tx, access.actor.tenantId, [
          requester.id,
          approvers.teamLeadId,
          approvers.hodId,
          approvers.hrApproverId,
        ]);
        const tenant = await tx.tenant.findUnique({
          where: { id: access.actor.tenantId },
          select: { slug: true, name: true },
        });

        const plans = this.planSubmission({
          access,
          request: created as unknown as Record<string, any>,
          requester,
          approvers,
          users,
          tenantSlug: tenant?.slug ?? null,
        });

        return { row: created, plans };
      },
    );

    await this.dispatch(result.plans);
    await this.invalidateOverview(access.actor.tenantId);
    return result.row;
  }

  async transition(
    access: ResolvedModuleAccess,
    id: string,
    body: Record<string, unknown>,
    context: LeaveWriteContext = {},
  ): Promise<unknown> {
    this.assertWorkflow(access);
    this.assertId(id);

    const action = body?.action;
    if (!isLeaveAction(action)) {
      throw new BadRequestException({
        code: 'INVALID_LEAVE_ACTION',
        message: 'action must be APPROVE, REJECT or CANCEL.',
        field: 'action',
      });
    }

    const note = this.validateNote(body?.note, action);

    const result = await this.prisma.withTenant<TransitionOutcome>(
      access.actor.tenantId,
      async (tx) => {
        const record = await tx.leaveRequest.findFirst({
          where: {
            id,
            tenantId: access.actor.tenantId,
            deletedAt: null,
          },
          include: LEAVE_INCLUDE,
        });

        if (!record) throw this.notFound();

        if (isTerminalStatus(record.status)) {
          throw new ConflictException({
            code: 'LEAVE_TERMINAL',
            message:
              'This leave request has already been decided and cannot change.',
            status: record.status,
          });
        }

        const transition = transitionFor(record.status, action);
        if (!transition) {
          throw new ConflictException({
            code: 'LEAVE_INVALID_TRANSITION',
            message: `Cannot ${action.toLowerCase()} a request in ${record.status}.`,
            status: record.status,
          });
        }

        let override = false;

        if (action === 'CANCEL') {
          if (record.userId !== access.actor.id) {
            throw new ForbiddenException({
              code: 'LEAVE_CANCEL_FORBIDDEN',
              message: 'Only the requester can cancel a leave request.',
            });
          }
        } else {
          const check: ApproverCheck = checkApprover(record.status, {
            actorId: access.actor.id,
            requesterId: record.userId,
            teamLeadId: record.teamLeadId ?? null,
            hodId: record.hodId ?? null,
            hrApproverId: record.hrApproverId ?? null,
            isTenantAdmin: access.actor.isTenantAdmin,
          });

          if (!check.allowed) {
            throw new ForbiddenException({
              code: check.reason,
              message:
                check.reason === 'SELF_APPROVAL'
                  ? 'You cannot approve or reject your own leave request.'
                  : 'You are not the designated approver for this stage.',
              status: record.status,
            });
          }
          override = check.override;
        }

        const now = new Date();
        const data: Record<string, unknown> = {
          status: transition.to,
          currentStage: transition.stage,
        };

        if (action === 'CANCEL') {
          data.cancelledAt = now;
          data.decidedById = access.actor.id;
          data.decidedAt = now;
          data.decisionNote = note || null;
        } else if (transition.terminal) {
          data.decidedById = access.actor.id;
          data.decidedAt = now;
          if (note) data.decisionNote = note;
        } else if (note) {
          data.decisionNote = note;
        }

        // Conditional update serialises concurrent decisions. The loser sees
        // zero rows and receives 409 instead of overwriting the winner.
        const updated = await tx.leaveRequest.updateMany({
          where: {
            id,
            tenantId: access.actor.tenantId,
            status: record.status,
          },
          data: data as Prisma.LeaveRequestUpdateManyMutationInput,
        });

        if (updated.count === 0) {
          throw new ConflictException({
            code: 'LEAVE_CONFLICT',
            message:
              'This leave request changed while you were deciding. Reload and try again.',
          });
        }

        if (transition.to === 'APPROVED') {
          await this.materialiseAttendance(
            tx,
            record,
            access.actor.id,
            access.module.key,
            context,
          );
        }

        const after = await tx.leaveRequest.findFirst({
          where: { id, tenantId: access.actor.tenantId },
          include: LEAVE_INCLUDE,
        });

        const afterSnapshot = {
          ...(after as unknown as Record<string, unknown>),
          ...(override ? { override: true } : {}),
        };

        await this.audit.record(tx, null, {
          tenantId: access.actor.tenantId,
          departmentId: record.user?.departmentId ?? null,
          actorId: access.actor.id,
          action,
          entity: 'leave_requests',
          entityId: id,
          moduleKey: access.module.key,
          requestId: context.requestId ?? null,
          before: record as unknown as Record<string, unknown>,
          after: afterSnapshot,
          ip: context.ip,
          userAgent: context.userAgent,
        });

        const users = await this.loadUsers(tx, access.actor.tenantId, [
          record.userId,
          record.teamLeadId,
          record.hodId,
          record.hrApproverId,
          access.actor.id,
        ]);
        const tenant = await tx.tenant.findUnique({
          where: { id: access.actor.tenantId },
          select: { slug: true, name: true },
        });

        const plans = this.planTransition({
          access,
          request: (after ?? record) as unknown as Record<string, any>,
          beforeStatus: record.status,
          action,
          transitionTo: transition.to,
          override,
          note,
          users,
          tenantSlug: tenant?.slug ?? null,
        });

        return {
          row: (after ?? record) as unknown as Record<string, unknown>,
          plans,
          override,
        };
      },
    );

    await this.dispatch(result.plans);
    await this.invalidateOverview(access.actor.tenantId);
    return result.row;
  }

  /** Leave counts feed the department overview cards. */
  private async invalidateOverview(tenantId: string): Promise<void> {
    await this.cache?.invalidatePattern(
      `tenant:${tenantId}:departments:overview:*`,
    );
  }

  async timeline(access: ResolvedModuleAccess, id: string): Promise<unknown> {
    this.assertWorkflow(access);
    this.assertId(id);

    return this.prisma.withTenant(access.actor.tenantId, async (tx) => {
      const record = await tx.leaveRequest.findFirst({
        where: {
          id,
          tenantId: access.actor.tenantId,
          deletedAt: null,
        },
        include: LEAVE_INCLUDE,
      });

      if (!record) throw this.notFound();

      if (!(await this.visibleTo(tx, access, record))) {
        throw this.notFound();
      }

      const audits = await tx.auditLog.findMany({
        where: {
          tenantId: access.actor.tenantId,
          entity: 'leave_requests',
          entityId: id,
        },
        orderBy: { createdAt: 'asc' },
      });

      const actorIds = Array.from(
        new Set(
          audits
            .map((entry: Record<string, unknown>) => entry.actorId)
            .filter(
              (value: unknown): value is string => typeof value === 'string',
            ),
        ),
      );

      const users = await this.loadUsers(tx, access.actor.tenantId, actorIds);

      const timeline = audits.map((entry: Record<string, any>) => {
        const after = entry.after as Record<string, any> | null;
        return {
          id: entry.id,
          action: entry.action,
          actorId: entry.actorId,
          actorName:
            (entry.actorId && users.get(entry.actorId)?.name) || 'System',
          at: entry.createdAt,
          status: after?.status ?? null,
          note: after?.decisionNote ?? null,
          override: after?.override === true,
        };
      });

      if (!timeline.some((entry) => entry.action === 'SUBMIT')) {
        timeline.unshift({
          id: `${record.id}:submitted`,
          action: 'SUBMIT',
          actorId: record.userId,
          actorName: users.get(record.userId)?.name ?? 'Requester',
          at: record.submittedAt ?? record.createdAt,
          status: record.status,
          note: null,
          override: false,
        });
      }

      return { success: true, request: record, timeline };
    });
  }

  // ------------------------------------------------------------------
  // Approver resolution
  // ------------------------------------------------------------------

  private async resolveApprovers(
    tx: Prisma.TransactionClient,
    tenantId: string,
    requester: LeaveUser,
  ): Promise<ResolvedApprovers> {
    const teamLeadId = await this.resolveTeamLead(tx, tenantId, requester.id);
    const hodId = await this.resolveHod(tx, tenantId, requester);
    const hrApproverId = await this.resolveHrApprover(tx, tenantId);

    // If no lead exists but an HOD does, keep the first stage so the HOD can
    // approve instead of dropping straight to HR.
    const firstStage = Boolean(teamLeadId || hodId);

    return {
      teamLeadId,
      hodId,
      hrApproverId,
      status: firstStage ? 'PENDING_TEAM_LEAD' : 'PENDING_HR',
      currentStage: firstStage ? 1 : 2,
    };
  }

  private async resolveTeamLead(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
  ): Promise<string | null> {
    const memberships = await tx.teamMember.findMany({
      where: { tenantId, userId },
      select: { teamId: true },
    });

    if (memberships.length === 0) return null;

    const teams = await tx.team.findMany({
      where: {
        tenantId,
        id: { in: memberships.map((membership) => membership.teamId) },
        leadUserId: { not: null },
      },
      select: { leadUserId: true },
    });

    for (const team of teams) {
      if (team.leadUserId && team.leadUserId !== userId) {
        return team.leadUserId;
      }
    }

    return null;
  }

  private async resolveHod(
    tx: Prisma.TransactionClient,
    tenantId: string,
    requester: LeaveUser,
  ): Promise<string | null> {
    if (!requester.departmentId) return null;

    const department = await tx.department.findFirst({
      where: { tenantId, id: requester.departmentId },
      select: { managerId: true },
    });

    if (department?.managerId && department.managerId !== requester.id) {
      return department.managerId;
    }

    const head = await tx.user.findFirst({
      where: {
        tenantId,
        departmentId: requester.departmentId,
        id: { not: requester.id },
        status: 'ACTIVE',
        role: { slug: 'department_head' },
      },
      select: { id: true },
    });

    return head?.id ?? null;
  }

  private async resolveHrApprover(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string | null> {
    const hr = await tx.department.findFirst({
      where: { tenantId, key: 'human_resources' },
      select: { id: true, managerId: true },
    });

    if (hr?.managerId) return hr.managerId;

    if (hr) {
      const head = await tx.user.findFirst({
        where: {
          tenantId,
          departmentId: hr.id,
          status: 'ACTIVE',
          role: { slug: 'department_head' },
        },
        select: { id: true },
      });
      if (head?.id) return head.id;
    }

    const admin = await tx.user.findFirst({
      where: { tenantId, role: { isTenantAdmin: true } },
      select: { id: true },
    });

    return admin?.id ?? null;
  }

  // ------------------------------------------------------------------
  // Attendance materialisation
  // ------------------------------------------------------------------

  private async materialiseAttendance(
    tx: Prisma.TransactionClient,
    record: Record<string, any>,
    actorId: string,
    moduleKey: string,
    context: LeaveWriteContext,
  ): Promise<void> {
    const descriptor = this.registry.get('attendance_records') ?? null;
    const days = eachWorkingDay(record.startDate, record.endDate);

    for (const date of days) {
      const existing = await tx.attendanceRecord.findFirst({
        where: {
          tenantId: record.tenantId,
          userId: record.userId,
          date,
        },
      });

      if (
        existing &&
        existing.status === 'Leave' &&
        existing.leaveRequestId === record.id &&
        !existing.deletedAt
      ) {
        continue;
      }

      if (existing) {
        const updated = await tx.attendanceRecord.update({
          where: { id: existing.id },
          data: {
            status: 'Leave',
            leaveRequestId: record.id,
            deletedAt: null,
            deletedById: null,
          },
        });

        await this.audit.record(tx, descriptor, {
          tenantId: record.tenantId,
          departmentId: record.user?.departmentId ?? null,
          actorId,
          action: 'UPDATE',
          entity: 'attendance_records',
          entityId: existing.id,
          moduleKey,
          requestId: context.requestId ?? null,
          before: existing,
          after: updated,
          ip: context.ip,
          userAgent: context.userAgent,
        });
        continue;
      }

      const created = await tx.attendanceRecord.create({
        data: {
          tenantId: record.tenantId,
          userId: record.userId,
          date,
          status: 'Leave',
          leaveRequestId: record.id,
        },
      });

      await this.audit.record(tx, descriptor, {
        tenantId: record.tenantId,
        departmentId: record.user?.departmentId ?? null,
        actorId,
        action: 'CREATE',
        entity: 'attendance_records',
        entityId: created.id,
        moduleKey,
        requestId: context.requestId ?? null,
        before: null,
        after: created,
        ip: context.ip,
        userAgent: context.userAgent,
      });
    }
  }

  // ------------------------------------------------------------------
  // Notification planning
  // ------------------------------------------------------------------

  private planSubmission(input: {
    access: ResolvedModuleAccess;
    request: Record<string, any>;
    requester: LeaveUser;
    approvers: ResolvedApprovers;
    users: Map<string, LeaveUser>;
    tenantSlug: string | null;
  }): NotificationPlan[] {
    const { access, request, requester, approvers, users, tenantSlug } = input;

    const approverId =
      approvers.status === 'PENDING_TEAM_LEAD'
        ? (approvers.teamLeadId ?? approvers.hodId)
        : approvers.hrApproverId;

    if (!approverId) return [];

    const approver = users.get(approverId);
    if (!approver) return [];

    const link = this.notificationLink(access, request.id);
    const dates = this.dateRange(request);
    const stage = approvers.status === 'PENDING_TEAM_LEAD' ? 'Team Lead' : 'HR';

    const plan: NotificationPlan = {
      notification: {
        tenantId: access.actor.tenantId,
        userId: approverId,
        type: 'LEAVE_SUBMITTED',
        title: 'Leave request needs review',
        message: `${requester.name} requested ${this.typeLabel(request.type)} leave for ${dates}.`,
        link,
        dedupeKey: `LEAVE_SUBMITTED:${request.id}:${request.status}:${approverId}`,
        metadata: this.metadata(request),
      },
      leaveEvent: {
        userId: approverId,
        data: {
          leaveRequestId: request.id,
          status: request.status,
          action: 'SUBMITTED',
        },
      },
    };

    if (this.email && this.emailLink && tenantSlug) {
      plan.email = {
        template: 'leave-submitted',
        input: {
          to: approver.email,
          approverName: approver.name,
          requesterName: requester.name,
          leaveType: this.typeLabel(request.type),
          startDate: new Date(request.startDate),
          endDate: new Date(request.endDate),
          days: Number(request.days),
          stage,
          reviewUrl: this.absoluteLink(tenantSlug, access, request.id),
          tenantId: access.actor.tenantId,
          idempotencyKey: `leave-submitted:${request.id}:${request.status}:${approverId}`,
        },
      };
    }

    return [plan];
  }

  private planTransition(input: {
    access: ResolvedModuleAccess;
    request: Record<string, any>;
    beforeStatus: string;
    action: LeaveAction;
    transitionTo: string;
    override: boolean;
    note: string;
    users: Map<string, LeaveUser>;
    tenantSlug: string | null;
  }): NotificationPlan[] {
    const {
      access,
      request,
      beforeStatus,
      action,
      transitionTo,
      users,
      tenantSlug,
    } = input;

    const plans: NotificationPlan[] = [];
    const requester = users.get(request.userId);
    const requesterId: string = request.userId;
    const actorId = access.actor.id;
    const actorName = users.get(actorId)?.name ?? 'An approver';
    const link = this.notificationLink(access, request.id);
    const dates = this.dateRange(request);

    const add = (plan: NotificationPlan, email?: LeaveEmailPlan): void => {
      if (
        plans.some(
          (entry) =>
            entry.notification.userId === plan.notification.userId &&
            entry.notification.dedupeKey === plan.notification.dedupeKey,
        )
      ) {
        return;
      }
      if (email) plan.email = email;
      plans.push(plan);
    };

    if (action === 'CANCEL') {
      // The requester cancelled: acknowledge in-app and tell the approver who
      // was expected to act.
      add({
        notification: {
          tenantId: access.actor.tenantId,
          userId: requesterId,
          type: 'LEAVE_DECIDED',
          title: 'Leave request cancelled',
          message: `Your ${this.typeLabel(request.type)} leave request was cancelled.`,
          link,
          dedupeKey: `LEAVE_CANCELLED:${request.id}:${requesterId}`,
          metadata: this.metadata(request),
        },
        leaveEvent: {
          userId: requesterId,
          data: {
            leaveRequestId: request.id,
            status: transitionTo,
            action,
          },
        },
      });

      const approverId =
        beforeStatus === 'PENDING_TEAM_LEAD'
          ? (request.teamLeadId ?? request.hodId)
          : request.hrApproverId;

      const approver = approverId ? users.get(approverId) : undefined;
      if (approver && approver.id !== requesterId && approver.id !== actorId) {
        add(
          {
            notification: {
              tenantId: access.actor.tenantId,
              userId: approver.id,
              type: 'LEAVE_DECIDED',
              title: 'Leave request cancelled',
              message:
                (requester?.name ?? 'The requester') +
                ` cancelled their ${this.typeLabel(request.type)} leave request.`,
              link,
              dedupeKey: `LEAVE_CANCELLED:${request.id}:${approver.id}`,
              metadata: this.metadata(request),
            },
            leaveEvent: {
              userId: approver.id,
              data: {
                leaveRequestId: request.id,
                status: transitionTo,
                action,
              },
            },
          },
          this.decisionEmail({
            recipient: approver,
            requesterName: approver.name,
            decidedByName: requester?.name ?? 'The requester',
            request,
            status: 'CANCELLED',
            note: input.note,
            access,
            tenantSlug,
          }),
        );
      }

      return plans;
    }

    if (transitionTo === 'PENDING_HR') {
      const hr = request.hrApproverId
        ? users.get(request.hrApproverId)
        : undefined;

      if (hr) {
        add(
          {
            notification: {
              tenantId: access.actor.tenantId,
              userId: hr.id,
              type: 'LEAVE_SUBMITTED',
              title: 'Leave request needs review',
              message: `${requester?.name ?? 'An employee'} requested ${this.typeLabel(request.type)} leave for ${dates}.`,
              link,
              dedupeKey: `LEAVE_SUBMITTED:${request.id}:PENDING_HR:${hr.id}`,
              metadata: this.metadata(request),
            },
            leaveEvent: {
              userId: hr.id,
              data: {
                leaveRequestId: request.id,
                status: 'PENDING_HR',
                action: 'APPROVED',
              },
            },
          },
          this.submittedEmail({
            recipient: hr,
            requesterName: requester?.name ?? 'A team member',
            request,
            stage: 'HR',
            access,
            tenantSlug,
            suffix: 'PENDING_HR',
          }),
        );
      }

      if (requester) {
        add({
          notification: {
            tenantId: access.actor.tenantId,
            userId: requester.id,
            type: 'LEAVE_PROGRESS',
            title: 'Leave request moved to HR',
            message: `Your ${this.typeLabel(request.type)} leave request passed the Team Lead stage and is now with HR.`,
            link,
            dedupeKey: `LEAVE_PROGRESS:${request.id}:PENDING_HR:${requester.id}`,
            metadata: this.metadata(request),
          },
          leaveEvent: {
            userId: requester.id,
            data: {
              leaveRequestId: request.id,
              status: 'PENDING_HR',
              action: 'APPROVED',
            },
          },
        });
      }

      return plans;
    }

    // Terminal decisions: notify the requester and any prior approver who did
    // not make the decision.
    const statusLabel = transitionTo.toLowerCase();
    const recipients = new Map<string, LeaveUser | undefined>();
    if (requester) recipients.set(requester.id, requester);
    for (const id of [request.teamLeadId, request.hodId]) {
      if (id && id !== actorId && id !== requesterId) {
        recipients.set(id, users.get(id));
      }
    }

    for (const recipient of recipients.values()) {
      if (!recipient) continue;
      const isRequester = recipient.id === requesterId;

      add(
        {
          notification: {
            tenantId: access.actor.tenantId,
            userId: recipient.id,
            type: 'LEAVE_DECIDED',
            title: `Leave request ${statusLabel}`,
            message: `${actorName} ${statusLabel} the ${this.typeLabel(request.type)} leave request${
              isRequester ? '' : ` from ${requester?.name ?? 'an employee'}`
            }.`,
            link,
            dedupeKey: `LEAVE_DECIDED:${request.id}:${transitionTo}:${recipient.id}`,
            metadata: this.metadata(request),
          },
          leaveEvent: {
            userId: recipient.id,
            data: {
              leaveRequestId: request.id,
              status: transitionTo,
              action,
              ...(input.override ? { override: true } : {}),
            },
          },
        },
        isRequester
          ? this.decisionEmail({
              recipient,
              requesterName: recipient.name,
              decidedByName: input.override
                ? `${actorName} (administrator override)`
                : actorName,
              request,
              status: transitionTo as LeaveDecisionEmailInput['status'],
              note: input.note,
              access,
              tenantSlug,
            })
          : undefined,
      );
    }

    return plans;
  }

  private submittedEmail(input: {
    recipient: LeaveUser;
    requesterName: string;
    request: Record<string, any>;
    stage: string;
    access: ResolvedModuleAccess;
    tenantSlug: string | null;
    suffix: string;
  }): LeaveEmailPlan | undefined {
    if (!this.email || !this.emailLink || !input.tenantSlug) return undefined;

    return {
      template: 'leave-submitted',
      input: {
        to: input.recipient.email,
        approverName: input.recipient.name,
        requesterName: input.requesterName,
        leaveType: this.typeLabel(input.request.type),
        startDate: new Date(input.request.startDate),
        endDate: new Date(input.request.endDate),
        days: Number(input.request.days),
        stage: input.stage,
        reviewUrl: this.absoluteLink(
          input.tenantSlug,
          input.access,
          input.request.id,
        ),
        tenantId: input.access.actor.tenantId,
        idempotencyKey: `leave-submitted:${input.request.id}:${input.suffix}:${input.recipient.id}`,
      },
    };
  }

  private decisionEmail(input: {
    recipient: LeaveUser;
    requesterName: string;
    decidedByName: string;
    request: Record<string, any>;
    status: LeaveDecisionEmailInput['status'];
    note: string;
    access: ResolvedModuleAccess;
    tenantSlug: string | null;
  }): LeaveEmailPlan | undefined {
    if (!this.email || !this.emailLink || !input.tenantSlug) return undefined;

    return {
      template: 'leave-decision',
      input: {
        to: input.recipient.email,
        requesterName: input.requesterName,
        status: input.status,
        decidedByName: input.decidedByName,
        note: input.note || undefined,
        leaveType: this.typeLabel(input.request.type),
        startDate: new Date(input.request.startDate),
        endDate: new Date(input.request.endDate),
        requestUrl: this.absoluteLink(
          input.tenantSlug,
          input.access,
          input.request.id,
        ),
        tenantId: input.access.actor.tenantId,
        idempotencyKey: `leave-decision:${input.request.id}:${input.status}:${input.recipient.id}`,
      },
    };
  }

  private async dispatch(plans: NotificationPlan[]): Promise<void> {
    if (!this.notifications) return;

    for (const plan of plans) {
      await this.notifications.notify(
        plan.notification,
        plan.email
          ? () => this.email!.send(plan.email!.template, plan.email!.input)
          : undefined,
      );

      if (plan.leaveEvent) {
        this.notifications.publishLeaveEvent(
          plan.notification.tenantId,
          plan.leaveEvent.userId,
          plan.leaveEvent.data,
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Validation and helpers
  // ------------------------------------------------------------------

  private assertWorkflow(access: ResolvedModuleAccess): WorkflowConfig {
    const config = access.config as WorkflowConfig;

    if (
      access.entity?.key !== 'leave_requests' ||
      config?.workflow !== 'leave-approval'
    ) {
      throw new BadRequestException({
        code: 'WORKFLOW_MISMATCH',
        message: 'This module is not the leave approval workflow.',
        moduleKey: access.module.key,
      });
    }

    return config;
  }

  private validateCreate(
    access: ResolvedModuleAccess,
    body: Record<string, unknown>,
    config: WorkflowConfig,
  ): {
    type: string;
    startDate: Date;
    endDate: Date;
    days: number;
    reason: string;
  } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException({
        code: 'INVALID_BODY',
        message: 'Request body must be a JSON object.',
      });
    }

    const allowed = new Set(
      config.requesterFields.length > 0
        ? config.requesterFields
        : REQUESTER_FIELDS,
    );

    for (const key of Object.keys(body)) {
      if (!allowed.has(key)) {
        throw new BadRequestException({
          code: 'UNKNOWN_FIELD',
          message: `Field "${key}" is not accepted by this leave workflow.`,
          field: key,
        });
      }
    }

    const rawType = body.type;
    const type =
      rawType === undefined || rawType === null || rawType === ''
        ? 'ANNUAL'
        : typeof rawType === 'string'
          ? rawType.toUpperCase()
          : '';

    if (!(LEAVE_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException({
        code: 'INVALID_LEAVE_TYPE',
        message: `type must be one of: ${LEAVE_TYPES.join(', ')}.`,
        field: 'type',
      });
    }

    const startDate = parseLeaveDate(body.startDate);
    const endDate = parseLeaveDate(body.endDate);

    if (!startDate || !endDate) {
      throw new BadRequestException({
        code: 'INVALID_LEAVE_DATE',
        message: 'startDate and endDate must be valid dates.',
      });
    }

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: 'endDate cannot be before startDate.',
      });
    }

    if (isPastDate(startDate) && !this.backdatingAllowed(access)) {
      throw new BadRequestException({
        code: 'LEAVE_BACKDATED',
        message: 'Leave requests cannot start in the past.',
        field: 'startDate',
      });
    }

    const days = workingDays(startDate, endDate);
    if (days === 0) {
      throw new BadRequestException({
        code: 'NO_WORKING_DAYS',
        message: 'The selected range does not include a working day.',
      });
    }

    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    if (reason.length === 0) {
      throw new BadRequestException({
        code: 'MISSING_REASON',
        message: 'A reason is required.',
        field: 'reason',
      });
    }

    if (reason.length > MAX_REASON_LENGTH) {
      throw new BadRequestException({
        code: 'REASON_TOO_LONG',
        message: `Reason must be at most ${MAX_REASON_LENGTH} characters.`,
        field: 'reason',
      });
    }

    return { type, startDate, endDate, days, reason };
  }

  private validateNote(value: unknown, action: LeaveAction): string {
    if (value === undefined || value === null) {
      if (action === 'REJECT') {
        throw new BadRequestException({
          code: 'NOTE_REQUIRED',
          message: 'A note is required when rejecting a leave request.',
          field: 'note',
        });
      }
      return '';
    }

    if (typeof value !== 'string') {
      throw new BadRequestException({
        code: 'INVALID_NOTE',
        message: 'note must be a string.',
        field: 'note',
      });
    }

    const note = value.trim();

    if (note.length > MAX_NOTE_LENGTH) {
      throw new BadRequestException({
        code: 'NOTE_TOO_LONG',
        message: `note must be at most ${MAX_NOTE_LENGTH} characters.`,
        field: 'note',
      });
    }

    if (action === 'REJECT' && note.length === 0) {
      throw new BadRequestException({
        code: 'NOTE_REQUIRED',
        message: 'A note is required when rejecting a leave request.',
        field: 'note',
      });
    }

    return note;
  }

  private backdatingAllowed(access: ResolvedModuleAccess): boolean {
    if (access.actor.isTenantAdmin) return true;
    return (
      (process.env.LEAVE_ALLOW_BACKDATED ?? 'false').toLowerCase() === 'true'
    );
  }

  private async visibleTo(
    tx: Prisma.TransactionClient,
    access: ResolvedModuleAccess,
    record: Record<string, any>,
  ): Promise<boolean> {
    if (access.actor.isTenantAdmin) return true;
    if (record.userId === access.actor.id) return true;
    if (
      [record.teamLeadId, record.hodId, record.hrApproverId].includes(
        access.actor.id,
      )
    ) {
      return true;
    }

    const descriptor = access.entity;
    if (!descriptor) return false;

    const scope = await this.scopes.build(
      descriptor,
      access.actor,
      access.module.dataScope,
    );

    const match = await tx.leaveRequest.findFirst({
      where: {
        AND: [
          scope.where,
          {
            id: record.id,
            tenantId: access.actor.tenantId,
          },
        ],
      },
      select: { id: true },
    });

    return Boolean(match);
  }

  private async loadUser(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<LeaveUser | null> {
    const user = await tx.user.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, email: true, departmentId: true },
    });
    return (user as LeaveUser | null) ?? null;
  }

  private async loadUsers(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, LeaveUser>> {
    const unique = Array.from(
      new Set(ids.filter((id): id is string => typeof id === 'string')),
    );

    if (unique.length === 0) return new Map();

    const users = await tx.user.findMany({
      where: { tenantId, id: { in: unique } },
      select: { id: true, name: true, email: true, departmentId: true },
    });

    return new Map((users as LeaveUser[]).map((user) => [user.id, user]));
  }

  private notificationLink(access: ResolvedModuleAccess, id: string): string {
    return `${access.module.path}?open=${encodeURIComponent(id)}`;
  }

  private absoluteLink(
    tenantSlug: string,
    access: ResolvedModuleAccess,
    id: string,
  ): string {
    return this.emailLink!.build(tenantSlug, access.module.path, { open: id });
  }

  private dateRange(request: Record<string, any>): string {
    return `${this.shortDate(request.startDate)} to ${this.shortDate(request.endDate)}`;
  }

  private shortDate(value: unknown): string {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  private typeLabel(type: unknown): string {
    const raw = typeof type === 'string' && type.length > 0 ? type : 'ANNUAL';
    const value = raw.toLowerCase();
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  private metadata(request: Record<string, any>): Record<string, unknown> {
    return {
      leaveRequestId: request.id,
      status: request.status,
      type: request.type,
      startDate: this.shortDate(request.startDate),
      endDate: this.shortDate(request.endDate),
      days: request.days,
    };
  }

  private assertId(id: string): void {
    if (!UUID_PATTERN.test(id)) throw this.notFound();
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'LEAVE_NOT_FOUND',
      message: 'Leave request was not found.',
    });
  }
}

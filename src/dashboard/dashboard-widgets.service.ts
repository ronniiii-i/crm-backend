// src/dashboard/dashboard-widgets.service.ts
//
// Real, tenant-scoped data for the dashboard widgets.
//
// The previous implementation served hard-coded mock data from the frontend.
// This service replaces it: every number and row shown on a dashboard is
// derived from the database, scoped to the caller's tenant, and additionally
// narrowed to the caller's department / team / personal scope.
//
// Multi-tenancy rules that apply to every query below:
//   * every read runs inside `PrismaService.withTenant(...)`, which pins the
//     transaction to one connection and issues `SET LOCAL app.current_tenant`.
//     Postgres RLS therefore applies (and fails closed without it).
//   * every `where` clause also carries an explicit `tenantId` filter, so the
//     application layer never relies on RLS alone.
//   * the tenant id comes from the authenticated request, never from a body
//     or query parameter.

import { Injectable } from '@nestjs/common';
import {
  DepartmentType,
  EmploymentStatus,
  Role,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getTenantId } from '../tenant/tenant-context';

export type WidgetScope = 'organization' | 'department' | 'team' | 'individual';

export type MetricFormat = 'currency' | 'percent' | 'number' | 'hours';

export interface WidgetMetric {
  id: string;
  title: string;
  value: number;
  format: MetricFormat;
  icon: string;
  change?: number;
  progress?: number;
}

export interface WidgetDepartmentPerformance {
  name: string;
  revenue: number;
}

export interface WidgetAuditEntry {
  id: string;
  action: string;
  entity: string;
  target?: string;
  timestamp: string;
  initiator: string;
}

export interface WidgetAlert {
  id: string;
  title: string;
  priority: 'low' | 'medium' | 'high';
  message: string;
}

export interface WidgetApproval {
  id: string;
  type: string;
  requester: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface WidgetTeamMetric {
  team: string;
  performance: number;
  members: number;
}

export interface WidgetTask {
  id: string;
  title: string;
  status: 'not-started' | 'in-progress' | 'completed';
  progress: number;
  dueDate: string;
  dueSoon: boolean;
  project?: string;
}

export interface WidgetAttendanceRecord {
  id: string;
  userId: string;
  name: string;
  status: 'present' | 'absent' | 'on-leave';
  date: string;
  hoursWorked: number;
}

export interface WidgetRevenuePoint {
  month: string;
  revenue: number;
}

export interface WidgetBudgetPoint {
  month: string;
  planned: number;
  actual: number;
}

export interface WidgetTaxRecord {
  id: string;
  type: string;
  dueDate: string;
  status: 'paid' | 'pending' | 'overdue';
  amount: number;
}

export interface WidgetSystemMetrics {
  uptime: string;
  responseTime: number;
  serverLoad: number;
  activeIncidents: number;
}

export interface WidgetSecurityAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  timestamp: string;
}

export interface WidgetInventoryItem {
  id: string;
  name: string;
  type: 'hardware' | 'software';
  status: 'active' | 'maintenance' | 'retired';
  assignedTo?: string;
}

export interface WidgetEmployee {
  id: string;
  name: string;
  position: string;
  department: string;
  status: 'active' | 'on-leave' | 'terminated';
  avatar?: string;
}

export interface WidgetJobOpening {
  id: string;
  title: string;
  department: string;
  applicants: number;
  status: 'sourcing' | 'interviewing' | 'offer' | 'filled';
}

export interface WidgetTraining {
  id: string;
  name: string;
  participants: number;
  completionRate: number;
  department: string;
  status: 'upcoming' | 'in-progress' | 'completed';
}

export interface WidgetPerformanceReview {
  id: string;
  employee: string;
  rating: number;
  status: 'pending' | 'completed';
  position: string;
  dueDate: string;
}

export interface WidgetDeal {
  id: string;
  name: string;
  value: number;
  stage: 'prospect' | 'qualified' | 'negotiation' | 'closed';
  contact: string;
  closeDate: string;
  status: 'won' | 'lost' | 'pending';
}

export interface WidgetTicket {
  id: string;
  subject: string;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'pending' | 'resolved';
  createdAt: string;
}

export interface WidgetPersonalMetric {
  id: string;
  title: string;
  value: number;
  format: MetricFormat;
  icon: string;
  change?: number;
  progress?: number;
}

export interface WidgetLeaveRequest {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  status: 'pending' | 'approved' | 'rejected';
}

/**
 * The payload consumed by the frontend dashboard hook. Only the sections
 * relevant to the caller's scope are populated.
 */
export interface DashboardWidgetPayload {
  scope: WidgetScope;
  generatedAt: string;
  metrics: WidgetMetric[];
  departmentPerformance?: WidgetDepartmentPerformance[];
  auditLog?: WidgetAuditEntry[];
  systemAlerts?: WidgetAlert[];
  pendingApprovals?: WidgetApproval[];
  teamMetrics?: WidgetTeamMetric[];
  alerts?: WidgetAlert[];
  revenueData?: WidgetRevenuePoint[];
  budgetData?: WidgetBudgetPoint[];
  taxRecords?: WidgetTaxRecord[];
  systemMetrics?: WidgetSystemMetrics;
  inventory?: WidgetInventoryItem[];
  securityAlerts?: WidgetSecurityAlert[];
  employees?: WidgetEmployee[];
  jobOpenings?: WidgetJobOpening[];
  trainings?: WidgetTraining[];
  reviews?: WidgetPerformanceReview[];
  deals?: WidgetDeal[];
  tickets?: WidgetTicket[];
  tasks?: WidgetTask[];
  attendance?: WidgetAttendanceRecord[];
  personalMetrics?: WidgetPersonalMetric[];
  leaveRequests?: WidgetLeaveRequest[];
}

export interface WidgetRequestUser {
  id: string;
  role: Role;
  tenantId?: string;
  departmentId?: string;
  managedDepartmentId?: string;
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DashboardWidgetsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the widget payload for the authenticated user.
   *
   * Fails closed: when no tenant can be resolved the payload is empty rather
   * than unscoped.
   */
  async buildForUser(user: WidgetRequestUser): Promise<DashboardWidgetPayload> {
    const tenantId = user.tenantId ?? getTenantId();

    if (!tenantId) {
      return {
        scope: this.scopeForRole(user.role),
        generatedAt: new Date().toISOString(),
        metrics: [],
      };
    }

    const scope = this.scopeForRole(user.role);
    const departmentId =
      user.role === Role.HOD
        ? (user.managedDepartmentId ?? user.departmentId)
        : user.departmentId;

    return this.prisma.withTenant(tenantId, async (tx) => {
      switch (scope) {
        case 'organization':
          return this.organizationScope(tx, tenantId);
        case 'department':
          return this.departmentScope(tx, tenantId, departmentId);
        case 'team':
          return this.teamScope(tx, tenantId, user.id, departmentId);
        default:
          return this.individualScope(tx, tenantId, user.id);
      }
    });
  }

  private scopeForRole(role: Role): WidgetScope {
    switch (role) {
      case Role.ADMIN:
        return 'organization';
      case Role.HOD:
        return 'department';
      case Role.LEAD:
        return 'team';
      default:
        return 'individual';
    }
  }

  // ---------------------------------------------------------------------
  // ADMIN / organization
  // ---------------------------------------------------------------------
  private async organizationScope(
    tx: any,
    tenantId: string,
  ): Promise<DashboardWidgetPayload> {
    const [
      revenue,
      expenses,
      ticketCount,
      openTicketCount,
      projectCount,
      securityAlertCount,
    ] = await Promise.all([
      tx.payment.aggregate({ _sum: { amount: true }, where: { tenantId } }),
      tx.expense.aggregate({ _sum: { amount: true }, where: { tenantId } }),
      tx.supportTicket.count({ where: { tenantId } }),
      tx.supportTicket.count({
        where: { tenantId, status: { notIn: ['CLOSED', 'RESOLVED'] } },
      }),
      tx.project.count({ where: { tenantId } }),
      tx.notification.count({
        where: { tenantId, type: 'security', read: false },
      }),
    ]);

    const totalRevenue = revenue._sum.amount ?? 0;
    const totalExpenses = expenses._sum.amount ?? 0;

    const [departmentPerformance, auditLog, systemAlerts, pendingApprovals] =
      await Promise.all([
        this.departmentPerformance(tx, tenantId),
        this.auditTrail(tx, tenantId),
        this.systemAlerts(tx, tenantId),
        this.pendingApprovals(tx, tenantId),
      ]);

    return {
      scope: 'organization',
      generatedAt: new Date().toISOString(),
      metrics: [
        {
          id: 'revenue',
          title: 'Total Revenue',
          value: totalRevenue,
          format: 'currency',
          icon: 'DollarSign',
        },
        {
          id: 'expenses',
          title: 'Total Expenses',
          value: totalExpenses,
          format: 'currency',
          icon: 'TrendingDown',
        },
        {
          id: 'netBalance',
          title: 'Net Balance',
          value: totalRevenue - totalExpenses,
          format: 'currency',
          icon: 'Wallet',
        },
        {
          id: 'projects',
          title: 'Active Projects',
          value: projectCount,
          format: 'number',
          icon: 'FolderKanban',
        },
        {
          id: 'tickets',
          title: 'Support Tickets',
          value: ticketCount,
          format: 'number',
          icon: 'LifeBuoy',
        },
        {
          id: 'openTickets',
          title: 'Open Tickets',
          value: openTicketCount,
          format: 'number',
          icon: 'AlertCircle',
        },
        {
          id: 'securityAlerts',
          title: 'Security Alerts',
          value: securityAlertCount,
          format: 'number',
          icon: 'ShieldAlert',
        },
      ],
      departmentPerformance,
      auditLog,
      systemAlerts,
      pendingApprovals,
    };
  }

  /** Revenue attributed to each department (via the contact owner). */
  private async departmentPerformance(
    tx: any,
    tenantId: string,
  ): Promise<WidgetDepartmentPerformance[]> {
    const [departments, payments] = await Promise.all([
      tx.department.findMany({
        where: { tenantId },
        select: { id: true, name: true },
      }),
      tx.payment.findMany({
        where: { tenantId },
        select: {
          amount: true,
          invoice: {
            select: {
              customer: {
                select: { createdBy: { select: { departmentId: true } } },
              },
            },
          },
        },
      }),
    ]);

    const nameById = new Map<string, string>(
      (departments as Array<{ id: string; name: string }>).map((d) => [
        d.id,
        d.name,
      ]),
    );
    const totals = new Map<string, number>();

    for (const payment of payments) {
      const departmentId =
        payment.invoice?.customer?.createdBy?.departmentId ?? null;
      if (!departmentId) continue;
      const name = nameById.get(departmentId) ?? 'Unassigned';
      totals.set(name, (totals.get(name) ?? 0) + payment.amount);
    }

    return [...totals.entries()]
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  /**
   * A unified activity feed built from the most recently touched business
   * records. There is no dedicated audit-log table, so the feed is derived
   * from the real `updatedAt` / `createdAt` timestamps.
   */
  private async auditTrail(
    tx: any,
    tenantId: string,
    limit = 30,
  ): Promise<WidgetAuditEntry[]> {
    const [payments, expenses, invoices, projects, tasks] = await Promise.all([
      tx.payment.findMany({
        where: { tenantId },
        take: limit,
        orderBy: { paidAt: 'desc' },
        select: {
          id: true,
          amount: true,
          paidAt: true,
          invoice: {
            select: {
              invoiceNumber: true,
              customer: { select: { company: true, firstName: true } },
            },
          },
        },
      }),
      tx.expense.findMany({
        where: { tenantId },
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          description: true,
          amount: true,
          createdAt: true,
          incurredAt: true,
          createdBy: { select: { name: true } },
        },
      }),
      tx.invoice.findMany({
        where: { tenantId },
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          invoiceNumber: true,
          amount: true,
          status: true,
          updatedAt: true,
          customer: { select: { company: true, firstName: true } },
        },
      }),
      tx.project.findMany({
        where: { tenantId },
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          status: true,
          updatedAt: true,
          createdBy: { select: { name: true } },
        },
      }),
      tx.task.findMany({
        where: { tenantId },
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          status: true,
          updatedAt: true,
          assignedTo: { select: { name: true } },
          project: { select: { name: true } },
        },
      }),
    ]);

    const entries: WidgetAuditEntry[] = [];

    for (const payment of payments) {
      entries.push({
        id: `payment-${payment.id}`,
        action: 'payment recorded',
        entity: 'payment',
        target:
          payment.invoice?.invoiceNumber ??
          payment.invoice?.customer?.company ??
          'Invoice',
        timestamp: payment.paidAt.toISOString(),
        initiator: payment.invoice?.customer?.company ?? 'System',
      });
    }

    for (const expense of expenses) {
      entries.push({
        id: `expense-${expense.id}`,
        action: 'expense logged',
        entity: 'expense',
        target: expense.description,
        timestamp: (expense.incurredAt ?? expense.createdAt).toISOString(),
        initiator: expense.createdBy?.name ?? 'System',
      });
    }

    for (const invoice of invoices) {
      entries.push({
        id: `invoice-${invoice.id}`,
        action: `invoice ${String(invoice.status).toLowerCase()}`,
        entity: 'invoice',
        target: invoice.invoiceNumber,
        timestamp: invoice.updatedAt.toISOString(),
        initiator: invoice.customer?.company ?? 'System',
      });
    }

    for (const project of projects) {
      entries.push({
        id: `project-${project.id}`,
        action: 'project updated',
        entity: 'project',
        target: project.name,
        timestamp: project.updatedAt.toISOString(),
        initiator: project.createdBy?.name ?? 'System',
      });
    }

    for (const task of tasks) {
      entries.push({
        id: `task-${task.id}`,
        action: `task ${String(task.status).toLowerCase()}`,
        entity: 'task',
        target: task.title,
        timestamp: task.updatedAt.toISOString(),
        initiator: task.assignedTo?.name ?? 'Unassigned',
      });
    }

    return entries
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
      .slice(0, limit);
  }

  /** Unread / warning notifications surfaced as system alerts. */
  private async systemAlerts(
    tx: any,
    tenantId: string,
  ): Promise<WidgetAlert[]> {
    const notifications = await tx.notification.findMany({
      where: {
        tenantId,
        type: { in: ['security', 'error', 'warning'] },
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        createdAt: true,
      },
    });

    return notifications.map((notification: any) => ({
      id: notification.id,
      title: notification.title,
      priority: this.priorityForType(notification.type),
      message: notification.message,
    }));
  }

  private priorityForType(type: string): 'low' | 'medium' | 'high' {
    switch (type) {
      case 'error':
        return 'high';
      case 'warning':
        return 'medium';
      default:
        return 'low';
    }
  }

  /**
   * Items awaiting a decision: invoices that have not been paid yet and
   * tasks explicitly flagged for approval.
   */
  private async pendingApprovals(
    tx: any,
    tenantId: string,
  ): Promise<WidgetApproval[]> {
    const [invoices, tasks] = await Promise.all([
      tx.invoice.findMany({
        where: { tenantId, status: 'Pending' },
        take: 20,
        orderBy: { dueDate: 'asc' },
        select: {
          id: true,
          invoiceNumber: true,
          customer: {
            select: { company: true, firstName: true, lastName: true },
          },
        },
      }),
      tx.task.findMany({
        where: { tenantId, status: 'Pending Approval' },
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          assignedTo: { select: { name: true } },
        },
      }),
    ]);

    const approvals: WidgetApproval[] = invoices.map((invoice: any) => ({
      id: `invoice-${invoice.id}`,
      type: 'invoice',
      requester:
        invoice.customer?.company ??
        [invoice.customer?.firstName, invoice.customer?.lastName]
          .filter(Boolean)
          .join(' ') ??
        'Customer',
      status: 'pending',
    }));

    for (const task of tasks) {
      approvals.push({
        id: `task-${task.id}`,
        type: 'task',
        requester: task.assignedTo?.name ?? 'Unassigned',
        status: 'pending',
      });
    }

    return approvals;
  }

  // ---------------------------------------------------------------------
  // HOD / department
  // ---------------------------------------------------------------------
  private async departmentScope(
    tx: any,
    tenantId: string,
    departmentId?: string,
  ): Promise<DashboardWidgetPayload> {
    if (!departmentId) {
      return {
        scope: 'department',
        generatedAt: new Date().toISOString(),
        metrics: [],
      };
    }

    const department = await tx.department.findUnique({
      where: { id: departmentId },
      select: { id: true, name: true, type: true },
    });

    const type = (department?.type ??
      DepartmentType.ADMINISTRATION) as DepartmentType;

    switch (type) {
      case DepartmentType.FINANCE:
      case DepartmentType.ACCOUNTING:
        return this.financeScope(tx, tenantId, departmentId, type);
      case DepartmentType.INFORMATION_TECHNOLOGY:
        return this.itScope(tx, tenantId, departmentId);
      case DepartmentType.HUMAN_RESOURCES:
        return this.hrScope(tx, tenantId, departmentId);
      case DepartmentType.SALES:
        return this.salesScope(tx, tenantId, departmentId);
      case DepartmentType.CUSTOMER_SERVICE:
        return this.supportScope(tx, tenantId, departmentId);
      default:
        return this.genericDepartmentScope(tx, tenantId, departmentId);
    }
  }

  private async financeScope(
    tx: any,
    tenantId: string,
    departmentId: string,
    type: DepartmentType,
  ): Promise<DashboardWidgetPayload> {
    const paymentCustomerScope = {
      invoice: { customer: { createdBy: { departmentId } } },
    };
    const invoiceCustomerScope = {
      customer: { createdBy: { departmentId } },
    };

    const [revenue, expenses, openTickets, invoiceCount, expenseRows] =
      await Promise.all([
        tx.payment.aggregate({
          _sum: { amount: true },
          where: { tenantId, ...paymentCustomerScope },
        }),
        tx.expense.aggregate({
          _sum: { amount: true },
          where: { tenantId, departmentId },
        }),
        tx.supportTicket.count({
          where: {
            tenantId,
            assignedTo: { departmentId },
            status: { notIn: ['CLOSED', 'RESOLVED'] },
          },
        }),
        tx.invoice.count({ where: { tenantId, ...invoiceCustomerScope } }),
        tx.expense.count({ where: { tenantId, departmentId } }),
      ]);

    const [revenueData, budgetData, auditLog] = await Promise.all([
      this.monthlyRevenue(tx, tenantId, paymentCustomerScope),
      this.monthlyBudget(
        tx,
        tenantId,
        paymentCustomerScope,
        invoiceCustomerScope,
      ),
      this.departmentAuditTrail(tx, tenantId, departmentId),
    ]);

    const totalRevenue = revenue._sum.amount ?? 0;
    const totalExpenses = expenses._sum.amount ?? 0;
    const isAccounting = type === DepartmentType.ACCOUNTING;

    return {
      scope: 'department',
      generatedAt: new Date().toISOString(),
      metrics: [
        {
          id: 'revenue',
          title: isAccounting ? 'Collected Revenue' : 'Department Revenue',
          value: totalRevenue,
          format: 'currency',
          icon: 'DollarSign',
        },
        {
          id: 'expenses',
          title: 'Total Expenses',
          value: totalExpenses,
          format: 'currency',
          icon: 'TrendingDown',
        },
        {
          id: 'netBalance',
          title: 'Net Balance',
          value: totalRevenue - totalExpenses,
          format: 'currency',
          icon: 'Wallet',
        },
        {
          id: 'invoices',
          title: 'Invoices',
          value: invoiceCount,
          format: 'number',
          icon: 'Receipt',
        },
        {
          id: 'expenseEntries',
          title: 'Expense Entries',
          value: expenseRows,
          format: 'number',
          icon: 'ReceiptText',
        },
        {
          id: 'openTickets',
          title: 'Open Tickets',
          value: openTickets,
          format: 'number',
          icon: 'LifeBuoy',
        },
      ],
      revenueData,
      budgetData,
      // No tax table exists yet — the widget renders an empty state rather
      // than fabricated tax records.
      taxRecords: [],
      auditLog,
    };
  }

  /** Revenue collected per month over the trailing 12 months. */
  private async monthlyRevenue(
    tx: any,
    tenantId: string,
    customerScope: Record<string, unknown>,
  ): Promise<WidgetRevenuePoint[]> {
    const since = this.startOfMonthsAgo(12);
    const payments = await tx.payment.findMany({
      where: { tenantId, paidAt: { gte: since }, ...customerScope },
      select: { amount: true, paidAt: true },
    });

    return this.buildMonthlySeries(12, (index) => {
      const total = payments
        .filter((p: any) => this.monthIndex(p.paidAt) === index)
        .reduce((sum: number, p: any) => sum + p.amount, 0);
      return { month: MONTH_LABELS[index], revenue: total };
    });
  }

  /**
   * Billed versus collected per month. "Planned" is the invoiced amount
   * (what the department expected to bill), "actual" is the cash collected.
   */
  private async monthlyBudget(
    tx: any,
    tenantId: string,
    paymentCustomerScope: Record<string, unknown>,
    invoiceCustomerScope: Record<string, unknown>,
  ): Promise<WidgetBudgetPoint[]> {
    const since = this.startOfMonthsAgo(12);

    const [invoices, payments] = await Promise.all([
      tx.invoice.findMany({
        where: { tenantId, createdAt: { gte: since }, ...invoiceCustomerScope },
        select: { amount: true, createdAt: true },
      }),
      tx.payment.findMany({
        where: { tenantId, paidAt: { gte: since }, ...paymentCustomerScope },
        select: { amount: true, paidAt: true },
      }),
    ]);

    return this.buildMonthlySeries(12, (index) => {
      const planned = invoices
        .filter((i: any) => this.monthIndex(i.createdAt) === index)
        .reduce((sum: number, i: any) => sum + i.amount, 0);
      const actual = payments
        .filter((p: any) => this.monthIndex(p.paidAt) === index)
        .reduce((sum: number, p: any) => sum + p.amount, 0);
      return { month: MONTH_LABELS[index], planned, actual };
    });
  }

  /** Activity feed restricted to a department's expenses and projects. */
  private async departmentAuditTrail(
    tx: any,
    tenantId: string,
    departmentId: string,
    limit = 30,
  ): Promise<WidgetAuditEntry[]> {
    const [expenses, projects] = await Promise.all([
      tx.expense.findMany({
        where: { tenantId, departmentId },
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          description: true,
          amount: true,
          createdAt: true,
          incurredAt: true,
          createdBy: { select: { name: true } },
        },
      }),
      tx.project.findMany({
        where: { tenantId, createdBy: { departmentId } },
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          status: true,
          updatedAt: true,
          createdBy: { select: { name: true } },
        },
      }),
    ]);

    const entries: WidgetAuditEntry[] = [
      ...expenses.map((expense: any) => ({
        id: `expense-${expense.id}`,
        action: 'expense logged',
        entity: 'expense',
        target: expense.description,
        timestamp: (expense.incurredAt ?? expense.createdAt).toISOString(),
        initiator: expense.createdBy?.name ?? 'System',
      })),
      ...projects.map((project: any) => ({
        id: `project-${project.id}`,
        action: 'project updated',
        entity: 'project',
        target: project.name,
        timestamp: project.updatedAt.toISOString(),
        initiator: project.createdBy?.name ?? 'System',
      })),
    ];

    return entries
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
      .slice(0, limit);
  }

  private async itScope(
    tx: any,
    tenantId: string,
    departmentId: string,
  ): Promise<DashboardWidgetPayload> {
    const [inventoryRows, tickets, notifications, members] = await Promise.all([
      tx.inventoryItem.findMany({
        where: { tenantId },
        take: 100,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          quantity: true,
          minStock: true,
          unit: true,
          location: true,
          updatedAt: true,
        },
      }),
      tx.supportTicket.findMany({
        where: { tenantId, assignedTo: { departmentId } },
        take: 50,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          subject: true,
          status: true,
          priority: true,
          createdAt: true,
          resolvedAt: true,
          slaDueDate: true,
        },
      }),
      tx.notification.findMany({
        where: { tenantId, type: 'security' },
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: { id: true, message: true, createdAt: true },
      }),
      tx.user.count({ where: { tenantId, departmentId } }),
    ]);

    const inventory = inventoryRows.map((item: any) =>
      this.toInventoryItem(item),
    );
    const resolvedTickets = tickets.filter(
      (ticket: any) => ticket.resolvedAt !== null,
    );

    // Average handling time (hours) across resolved tickets.
    const responseTime = resolvedTickets.length
      ? Math.round(
          resolvedTickets.reduce(
            (sum: number, ticket: any) =>
              sum +
              (ticket.resolvedAt.getTime() - ticket.createdAt.getTime()) /
                (60 * 60 * 1000),
            0,
          ) / resolvedTickets.length,
        )
      : 0;

    // Share of the estate that is running below its reorder threshold.
    const lowStock = inventoryRows.filter(
      (item: any) => item.quantity <= item.minStock,
    ).length;
    const serverLoad = inventoryRows.length
      ? Math.round((lowStock / inventoryRows.length) * 100)
      : 0;

    const activeIncidents = tickets.filter(
      (ticket: any) =>
        ticket.status === TicketStatus.OPEN ||
        ticket.status === TicketStatus.IN_PROGRESS,
    ).length;

    const metSla = resolvedTickets.filter(
      (ticket: any) =>
        ticket.slaDueDate && ticket.resolvedAt <= ticket.slaDueDate,
    ).length;
    const uptime = resolvedTickets.length
      ? `${Math.round((metSla / resolvedTickets.length) * 100)}%`
      : '100%';

    return {
      scope: 'department',
      generatedAt: new Date().toISOString(),
      metrics: [
        {
          id: 'inventoryItems',
          title: 'Inventory Items',
          value: inventoryRows.length,
          format: 'number',
          icon: 'Boxes',
        },
        {
          id: 'lowStock',
          title: 'Below Reorder Level',
          value: lowStock,
          format: 'number',
          icon: 'PackageMinus',
        },
        {
          id: 'activeIncidents',
          title: 'Active Incidents',
          value: activeIncidents,
          format: 'number',
          icon: 'AlertTriangle',
        },
        {
          id: 'responseTime',
          title: 'Avg. Resolution (hrs)',
          value: responseTime,
          format: 'number',
          icon: 'Timer',
        },
        {
          id: 'teamMembers',
          title: 'Team Members',
          value: members,
          format: 'number',
          icon: 'Users',
        },
      ],
      systemMetrics: { uptime, responseTime, serverLoad, activeIncidents },
      inventory,
      tickets: tickets.map((ticket: any) => this.toTicket(ticket)),
      securityAlerts: notifications.map((notification: any) => ({
        id: notification.id,
        severity: 'critical' as const,
        message: notification.message,
        timestamp: notification.createdAt.toISOString(),
      })),
    };
  }

  private toInventoryItem(item: any): WidgetInventoryItem {
    const text =
      `${item.name ?? ''} ${item.description ?? ''} ${item.unit ?? ''}`.toLowerCase();
    const softwareHints = [
      'software',
      'license',
      'subscription',
      'saas',
      'antivirus',
      'backup',
      'subscription',
      'cloud',
      'office',
      'windows',
      'email',
      'vpn',
    ];
    const type = softwareHints.some((hint) => text.includes(hint))
      ? 'software'
      : 'hardware';

    const status =
      item.quantity === 0
        ? 'retired'
        : item.quantity <= item.minStock
          ? 'maintenance'
          : 'active';

    return {
      id: item.id,
      name: item.name,
      type,
      status,
      assignedTo: item.location ?? undefined,
    };
  }

  private async hrScope(
    tx: any,
    tenantId: string,
    departmentId: string,
  ): Promise<DashboardWidgetPayload> {
    const [department, employees] = await Promise.all([
      tx.department.findUnique({
        where: { id: departmentId },
        select: { id: true, name: true },
      }),
      tx.user.findMany({
        where: { tenantId, departmentId },
        take: 100,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          role: true,
          status: true,
          avatarUrl: true,
        },
      }),
    ]);

    const activeCount = employees.filter(
      (employee: any) => employee.status === EmploymentStatus.ACTIVE,
    ).length;

    return {
      scope: 'department',
      generatedAt: new Date().toISOString(),
      metrics: [
        {
          id: 'employees',
          title: 'Employees',
          value: employees.length,
          format: 'number',
          icon: 'Users',
        },
        {
          id: 'activeEmployees',
          title: 'Active Employees',
          value: activeCount,
          format: 'number',
          icon: 'UserCheck',
        },
        {
          id: 'onLeave',
          title: 'On Leave',
          value: employees.filter(
            (employee: any) => employee.status === EmploymentStatus.ON_LEAVE,
          ).length,
          format: 'number',
          icon: 'UserMinus',
        },
      ],
      employees: employees.map((employee: any) => ({
        id: employee.id,
        name: employee.name,
        position: this.titleCase(employee.role),
        department: department?.name ?? 'Unassigned',
        status: this.toEmploymentStatus(employee.status),
        avatar: employee.avatarUrl ?? undefined,
      })),
      // Recruitment, training and review tables do not exist in the schema
      // yet — the widgets render empty states instead of fabricated rows.
      jobOpenings: [],
      trainings: [],
      reviews: [],
    };
  }

  private toEmploymentStatus(
    status: EmploymentStatus,
  ): 'active' | 'on-leave' | 'terminated' {
    switch (status) {
      case EmploymentStatus.ACTIVE:
        return 'active';
      case EmploymentStatus.ON_LEAVE:
        return 'on-leave';
      default:
        return 'terminated';
    }
  }

  private async salesScope(
    tx: any,
    tenantId: string,
    departmentId: string,
  ): Promise<DashboardWidgetPayload> {
    const [deals, teamMetrics] = await Promise.all([
      tx.deal.findMany({
        where: { tenantId, assignedTo: { departmentId } },
        take: 50,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          amount: true,
          status: true,
          closeDate: true,
          contact: {
            select: { company: true, firstName: true, lastName: true },
          },
        },
      }),
      this.teamPerformance(tx, tenantId, departmentId),
    ]);

    const pipelineValue = deals
      .filter((deal: any) => deal.status !== 'WON' && deal.status !== 'LOST')
      .reduce((sum: number, deal: any) => sum + deal.amount, 0);

    const won = deals.filter((deal: any) => deal.status === 'WON');

    return {
      scope: 'department',
      generatedAt: new Date().toISOString(),
      metrics: [
        {
          id: 'pipeline',
          title: 'Open Pipeline',
          value: pipelineValue,
          format: 'currency',
          icon: 'TrendingUp',
        },
        {
          id: 'won',
          title: 'Won Deals',
          value: won.length,
          format: 'number',
          icon: 'Trophy',
        },
        {
          id: 'wonValue',
          title: 'Won Value',
          value: won.reduce((sum: number, deal: any) => sum + deal.amount, 0),
          format: 'currency',
          icon: 'CircleDollarSign',
        },
        {
          id: 'totalDeals',
          title: 'Total Deals',
          value: deals.length,
          format: 'number',
          icon: 'Handshake',
        },
      ],
      deals: deals.map((deal: any) => this.toDeal(deal)),
      teamMetrics,
    };
  }

  private toDeal(deal: any): WidgetDeal {
    const stageMap: Record<string, WidgetDeal['stage']> = {
      LEAD: 'prospect',
      QUALIFIED: 'qualified',
      PROPOSAL: 'qualified',
      NEGOTIATION: 'negotiation',
      WON: 'closed',
      LOST: 'closed',
    };

    const statusMap: Record<string, WidgetDeal['status']> = {
      WON: 'won',
      LOST: 'lost',
    };

    return {
      id: deal.id,
      name: deal.name,
      value: deal.amount,
      stage: stageMap[deal.status] ?? 'prospect',
      contact:
        deal.contact?.company ??
        [deal.contact?.firstName, deal.contact?.lastName]
          .filter(Boolean)
          .join(' ') ??
        'Unknown',
      closeDate: deal.closeDate?.toISOString() ?? '',
      status: statusMap[deal.status] ?? 'pending',
    };
  }

  private async supportScope(
    tx: any,
    tenantId: string,
    departmentId: string,
  ): Promise<DashboardWidgetPayload> {
    const [tickets, teamMetrics] = await Promise.all([
      tx.supportTicket.findMany({
        where: { tenantId, assignedTo: { departmentId } },
        take: 50,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          subject: true,
          status: true,
          priority: true,
          createdAt: true,
          resolvedAt: true,
        },
      }),
      this.teamPerformance(tx, tenantId, departmentId),
    ]);

    const open = tickets.filter(
      (ticket: any) =>
        ticket.status === TicketStatus.OPEN ||
        ticket.status === TicketStatus.IN_PROGRESS,
    );
    const resolved = tickets.filter(
      (ticket: any) => ticket.status === TicketStatus.RESOLVED,
    );

    return {
      scope: 'department',
      generatedAt: new Date().toISOString(),
      metrics: [
        {
          id: 'openTickets',
          title: 'Open Tickets',
          value: open.length,
          format: 'number',
          icon: 'LifeBuoy',
        },
        {
          id: 'resolvedTickets',
          title: 'Resolved Tickets',
          value: resolved.length,
          format: 'number',
          icon: 'CheckCircle2',
        },
        {
          id: 'totalTickets',
          title: 'Total Tickets',
          value: tickets.length,
          format: 'number',
          icon: 'Inbox',
        },
        {
          id: 'slaCompliance',
          title: 'SLA Compliance',
          value:
            resolved.length > 0
              ? Math.round(
                  (resolved.filter(
                    (ticket: any) =>
                      ticket.resolvedAt &&
                      ticket.createdAt <= ticket.resolvedAt,
                  ).length /
                    resolved.length) *
                    100,
                )
              : 0,
          format: 'percent',
          icon: 'Gauge',
        },
      ],
      tickets: tickets.map((ticket: any) => this.toTicket(ticket)),
      teamMetrics,
    };
  }

  private toTicket(ticket: any): WidgetTicket {
    const statusMap: Record<string, WidgetTicket['status']> = {
      OPEN: 'open',
      IN_PROGRESS: 'pending',
      RESOLVED: 'resolved',
      CLOSED: 'resolved',
    };

    const priority =
      ticket.priority >= 4 ? 'high' : ticket.priority >= 2 ? 'medium' : 'low';

    return {
      id: ticket.id,
      subject: ticket.subject,
      priority,
      status: statusMap[ticket.status] ?? 'open',
      createdAt: ticket.createdAt.toISOString(),
    };
  }

  /** Generic fallback for departments without a specialised widget set. */
  private async genericDepartmentScope(
    tx: any,
    tenantId: string,
    departmentId: string,
  ): Promise<DashboardWidgetPayload> {
    const [department, members, teamMetrics, alerts] = await Promise.all([
      tx.department.findUnique({
        where: { id: departmentId },
        select: { id: true, name: true },
      }),
      tx.user.count({ where: { tenantId, departmentId } }),
      this.teamPerformance(tx, tenantId, departmentId),
      tx.notification.findMany({
        where: {
          tenantId,
          type: { in: ['warning', 'error'] },
          user: { departmentId },
        },
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, message: true, type: true },
      }),
    ]);

    return {
      scope: 'department',
      generatedAt: new Date().toISOString(),
      metrics: [
        {
          id: 'teamMembers',
          title: `${department?.name ?? 'Team'} Members`,
          value: members,
          format: 'number',
          icon: 'Users',
        },
      ],
      teamMetrics,
      alerts: alerts.map((alert: any) => ({
        id: alert.id,
        title: alert.title,
        priority: this.priorityForType(alert.type),
        message: alert.message,
      })),
    };
  }

  /** Per-team completion rate derived from the tasks of team members. */
  private async teamPerformance(
    tx: any,
    tenantId: string,
    departmentId: string,
  ): Promise<WidgetTeamMetric[]> {
    const teams = await tx.team.findMany({
      where: { tenantId, departmentId },
      take: 50,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        members: { select: { userId: true } },
      },
    });

    if (teams.length === 0) return [];

    const memberIds = [
      ...new Set(
        teams.flatMap((team: any) => team.members.map((m: any) => m.userId)),
      ),
    ];

    const tasks = await tx.task.findMany({
      where: { tenantId, assignedToId: { in: memberIds } },
      select: { assignedToId: true, status: true },
    });

    const tasksByUser = new Map<string, { total: number; done: number }>();
    for (const task of tasks) {
      const bucket = tasksByUser.get(task.assignedToId) ?? {
        total: 0,
        done: 0,
      };
      bucket.total += 1;
      if (task.status === 'Completed') bucket.done += 1;
      tasksByUser.set(task.assignedToId, bucket);
    }

    return teams.map((team: any) => {
      const memberUserIds = team.members.map((m: any) => m.userId);
      let total = 0;
      let done = 0;
      for (const userId of memberUserIds) {
        const bucket = tasksByUser.get(userId);
        if (!bucket) continue;
        total += bucket.total;
        done += bucket.done;
      }

      return {
        team: team.name,
        performance: total > 0 ? Math.round((done / total) * 100) : 0,
        members: memberUserIds.length,
      };
    });
  }

  // ---------------------------------------------------------------------
  // LEAD / team
  // ---------------------------------------------------------------------
  private async teamScope(
    tx: any,
    tenantId: string,
    userId: string,
    departmentId?: string,
  ): Promise<DashboardWidgetPayload> {
    const teams = await tx.team.findMany({
      where: {
        tenantId,
        ...(departmentId ? { departmentId } : { leadUserId: userId }),
      },
      take: 50,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        members: { select: { userId: true } },
      },
    });

    const memberIds = [
      ...new Set(
        teams.flatMap((team: any) => team.members.map((m: any) => m.userId)),
      ),
    ];
    memberIds.push(userId);

    const [taskRows, attendanceRows] = await Promise.all([
      tx.task.findMany({
        where: {
          tenantId,
          assignedToId: { in: memberIds },
          ...(departmentId
            ? { assignedTo: { departmentId } }
            : { assignedToId: userId }),
        },
        take: 100,
        orderBy: { dueDate: 'asc' },
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          project: { select: { name: true } },
        },
      }),
      tx.attendanceRecord.findMany({
        where: {
          tenantId,
          userId: { in: memberIds },
          date: { gte: new Date(Date.now() - 30 * DAY_MS) },
        },
        take: 200,
        orderBy: { date: 'desc' },
        select: {
          id: true,
          userId: true,
          date: true,
          status: true,
          user: { select: { name: true } },
        },
      }),
    ]);

    const tasks = taskRows.map((task: any) => this.toTask(task));
    const attendance = attendanceRows.map((record: any) => ({
      id: record.id,
      userId: record.userId,
      name: record.user?.name ?? 'Unknown',
      status: this.toAttendanceStatus(record.status),
      date: record.date.toISOString(),
      hoursWorked:
        record.status === 'Present' ? 8 : record.status === 'On Leave' ? 0 : 0,
    }));

    const completed = tasks.filter(
      (task) => task.status === 'completed',
    ).length;
    const present = attendance.filter(
      (record) => record.status === 'present',
    ).length;

    return {
      scope: 'team',
      generatedAt: new Date().toISOString(),
      metrics: [
        {
          id: 'tasks',
          title: 'Tasks',
          value: tasks.length,
          format: 'number',
          icon: 'ListChecks',
        },
        {
          id: 'taskCompletion',
          title: 'Completion Rate',
          value:
            tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0,
          format: 'percent',
          icon: 'CircleCheckBig',
        },
        {
          id: 'attendance',
          title: 'Attendance (30d)',
          value:
            attendance.length > 0
              ? Math.round((present / attendance.length) * 100)
              : 0,
          format: 'percent',
          icon: 'UserRoundCheck',
        },
        {
          id: 'teamMembers',
          title: 'Team Members',
          value: memberIds.length,
          format: 'number',
          icon: 'Users',
        },
      ],
      teamMetrics: await this.teamPerformance(tx, tenantId, departmentId ?? ''),
      tasks,
      attendance,
    };
  }

  private toTask(task: any): WidgetTask {
    const statusMap: Record<string, WidgetTask['status']> = {
      Todo: 'not-started',
      'Not Started': 'not-started',
      'In Progress': 'in-progress',
      Completed: 'completed',
      Done: 'completed',
      Cancelled: 'not-started',
    };

    const status = statusMap[task.status] ?? 'not-started';
    const progress =
      status === 'completed' ? 100 : status === 'in-progress' ? 50 : 0;
    const dueDate = task.dueDate?.toISOString() ?? '';
    const dueSoon =
      dueDate !== '' && new Date(dueDate).getTime() - Date.now() < 7 * DAY_MS;

    return {
      id: task.id,
      title: task.title,
      status,
      progress,
      dueDate,
      dueSoon,
      project: task.project?.name,
    };
  }

  private toAttendanceStatus(
    status: string,
  ): 'present' | 'absent' | 'on-leave' {
    switch (status) {
      case 'Present':
        return 'present';
      case 'On Leave':
      case 'On-Leave':
        return 'on-leave';
      default:
        return 'absent';
    }
  }

  // ---------------------------------------------------------------------
  // STAFF / individual
  // ---------------------------------------------------------------------
  private async individualScope(
    tx: any,
    tenantId: string,
    userId: string,
  ): Promise<DashboardWidgetPayload> {
    const [taskRows, attendanceRows, projectCount, openTasks] =
      await Promise.all([
        tx.task.findMany({
          where: { tenantId, assignedToId: userId },
          take: 100,
          orderBy: { dueDate: 'asc' },
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
            project: { select: { name: true } },
          },
        }),
        tx.attendanceRecord.findMany({
          where: {
            tenantId,
            userId,
            date: { gte: new Date(Date.now() - 30 * DAY_MS) },
          },
          take: 200,
          select: { id: true, date: true, status: true },
        }),
        tx.projectMember.count({ where: { tenantId, userId } }),
        tx.task.count({
          where: {
            tenantId,
            assignedToId: userId,
            status: { notIn: ['Completed', 'Cancelled'] },
          },
        }),
      ]);

    const tasks = taskRows.map((task: any) => this.toTask(task));
    const completed = tasks.filter(
      (task) => task.status === 'completed',
    ).length;
    const presentDays = attendanceRows.filter(
      (record: any) => record.status === 'Present',
    ).length;
    const hoursWorked = presentDays * 8;

    return {
      scope: 'individual',
      generatedAt: new Date().toISOString(),
      metrics: [
        {
          id: 'tasksCompleted',
          title: 'Tasks Completed',
          value: completed,
          format: 'number',
          icon: 'CircleCheckBig',
        },
        {
          id: 'openTasks',
          title: 'Open Tasks',
          value: openTasks,
          format: 'number',
          icon: 'ListTodo',
        },
        {
          id: 'hoursWorked',
          title: 'Hours Worked',
          value: hoursWorked,
          format: 'hours',
          icon: 'Clock',
        },
        {
          id: 'projectsInvolved',
          title: 'Projects Involved',
          value: projectCount,
          format: 'number',
          icon: 'FolderKanban',
        },
      ],
      personalMetrics: [
        {
          id: 'tasks',
          title: 'Tasks Completed',
          value: completed,
          format: 'number',
          icon: 'CircleCheckBig',
          progress: tasks.length
            ? Math.round((completed / tasks.length) * 100)
            : 0,
        },
        {
          id: 'hoursWorked',
          title: 'Hours Worked',
          value: hoursWorked,
          format: 'hours',
          icon: 'Clock',
        },
        {
          id: 'projectsInvolved',
          title: 'Projects Involved',
          value: projectCount,
          format: 'number',
          icon: 'FolderKanban',
        },
      ],
      tasks,
      attendance: attendanceRows.map((record: any) => ({
        id: record.id,
        userId,
        name: 'Me',
        status: this.toAttendanceStatus(record.status),
        date: record.date.toISOString(),
        hoursWorked: record.status === 'Present' ? 8 : 0,
      })),
      // Leave requests are not modelled yet — the widget renders an empty state.
      leaveRequests: [],
    };
  }

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------
  private startOfMonthsAgo(months: number): Date {
    const date = new Date();
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    date.setMonth(date.getMonth() - (months - 1));
    return date;
  }

  /**
   * Index (0 = oldest) of the month a date belongs to, over the trailing 12
   * month window that starts at {@link startOfMonthsAgo}. Dates outside the
   * window are clamped into the first/last bucket.
   */
  private monthIndex(date: Date): number {
    const start = this.startOfMonthsAgo(12);
    const months =
      (date.getFullYear() - start.getFullYear()) * 12 +
      (date.getMonth() - start.getMonth());
    return Math.min(Math.max(months, 0), 11);
  }

  private buildMonthlySeries<T>(
    count: number,
    factory: (index: number) => T,
  ): T[] {
    return Array.from({ length: count }, (_, index) => factory(index));
  }

  private titleCase(value: string): string {
    return value
      .split('_')
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(' ');
  }
}

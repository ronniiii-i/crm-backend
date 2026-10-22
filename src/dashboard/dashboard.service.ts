import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { PrismaService } from '../prisma/prisma.service'; // Adjust path if necessary
import { Role, Prisma } from '@prisma/client'; // Import Role enum from your Prisma client
import { Cache } from 'cache-manager'; // Import Cache type from cache-manager
import { getTenantId } from '../tenant/tenant-context';

interface DashboardUser {
  role: Role;
  departmentId?: string;
  userId: string;
  tenantId?: string;
}

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache, // Inject NestJS CacheManager
  ) {}

  /** Tenant-scoped cache key so tenants never share cached dashboards. */
  private tenantCacheKey(key: string, tenantId?: string): string {
    return `tenant:${tenantId ?? getTenantId() ?? 'global'}:${key}`;
  }

  /**
   * Run an aggregation inside the tenant transaction so Postgres RLS applies
   * on the same pooled connection as the query. Falls back to the plain client
   * when no tenant is available (RLS then fails closed at the DB layer).
   */
  private scoped<T>(
    tenantId: string | undefined,
    fn: (db: Prisma.TransactionClient | PrismaService) => Promise<T>,
  ): Promise<T> {
    const resolved = tenantId ?? getTenantId();
    if (!resolved) return fn(this.prisma);
    return this.prisma.withTenant(resolved, (tx) => fn(tx));
  }

  /**
   * Main method to get dashboard data based on user's role and context.
   */
  async getDashboardData(user: {
    role: Role;
    departmentId?: string;
    userId: string;
    tenantId?: string;
  }) {
    switch (user.role) {
      case Role.ADMIN:
        return this.getAdminDashboard(user.tenantId);
      case Role.HOD:
        if (!user.departmentId) {
          throw new Error('HOD user must have a departmentId.');
        }
        return this.getHodDashboard(user.departmentId, user.tenantId);
      case Role.LEAD:
        if (!user.departmentId || !user.userId) {
          throw new Error('Lead user must have departmentId and userId.');
        }
        return this.getLeadDashboard(
          user.departmentId,
          user.userId,
          user.tenantId,
        );
      case Role.STAFF:
        if (!user.departmentId || !user.userId) {
          throw new Error('Staff user must have departmentId and userId.');
        }
        return this.getStaffDashboard(
          user.departmentId,
          user.userId,
          user.tenantId,
        );
      default:
        throw new Error('Invalid user role provided.');
    }
  }

  // --- Private Methods for Each Role's Dashboard Data ---

  private async getAdminDashboard(tenantId?: string) {
    const cacheKey = this.tenantCacheKey('admin-dashboard', tenantId);
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const resolved = tenantId ?? getTenantId();
    if (!resolved) {
      // Fallback when no tenant context is available; RLS will fail closed.
      const [
        totalRevenue,
        totalExpenses,
        salesPipelineSummary,
        totalTickets,
        totalOpenTickets,
        projectStatuses,
        securityAlertsCount,
      ] = await Promise.all([
        this.getTotalRevenue(tenantId),
        this.getTotalExpenses(tenantId),
        this.getSalesPipelineSummary(tenantId),
        this.getTotalTickets(tenantId),
        this.getTotalOpenTickets(tenantId),
        this.getProjectStatuses(tenantId),
        this.getSecurityAlertsCount(tenantId),
      ]);

      const dashboardData = {
        totalRevenue,
        totalExpenses,
        salesPipelineSummary,
        totalTickets,
        totalOpenTickets,
        projectStatuses,
        securityAlertsCount,
      };

      await this.cacheManager.set(cacheKey, dashboardData);
      return dashboardData;
    }

    // Run all admin KPIs in a single tenant-scoped transaction to avoid
    // exhausting the connection pool with parallel transactions.
    const dashboardData = await this.prisma.withTenant(resolved, async (tx) => {
      const [
        totalRevenue,
        totalExpenses,
        salesPipelineSummary,
        totalTickets,
        totalOpenTickets,
        projectStatuses,
        securityAlertsCount,
      ] = await Promise.all([
        tx.payment.aggregate({
          _sum: { amount: true },
          where: { tenantId: resolved },
        }),
        tx.expense.aggregate({
          _sum: { amount: true },
          where: { tenantId: resolved },
        }),
        tx.deal.groupBy({
          by: ['status'],
          _sum: { amount: true },
          _count: { id: true },
          where: { tenantId: resolved },
          orderBy: { _sum: { amount: 'desc' } },
        }),
        tx.supportTicket.count({ where: { tenantId: resolved } }),
        tx.supportTicket.count({
          where: {
            tenantId: resolved,
            status: { notIn: ['CLOSED', 'RESOLVED'] },
          },
        }),
        tx.project.groupBy({
          by: ['status'],
          _count: { id: true },
          where: { tenantId: resolved },
          orderBy: { _count: { id: 'desc' } },
        }),
        tx.notification.count({
          where: { tenantId: resolved, type: 'security', read: false },
        }),
      ]);

      return {
        totalRevenue: totalRevenue._sum.amount || 0,
        totalExpenses: totalExpenses._sum.amount || 0,
        salesPipelineSummary,
        totalTickets,
        totalOpenTickets,
        projectStatuses,
        securityAlertsCount,
      };
    });

    await this.cacheManager.set(cacheKey, dashboardData);
    return dashboardData;
  }

  private async getHodDashboard(departmentId: string, tenantId?: string) {
    const cacheKey = this.tenantCacheKey(
      `hod-dashboard-${departmentId}`,
      tenantId,
    );
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const resolved = tenantId ?? getTenantId();
    let dashboardData: any;

    if (!resolved) {
      const [
        departmentRevenue,
        departmentExpenses,
        departmentOpenTickets,
        departmentProjectStatuses,
      ] = await Promise.all([
        this.getDepartmentRevenue(departmentId, tenantId),
        this.getDepartmentExpenses(departmentId, tenantId),
        this.getDepartmentOpenTickets(departmentId, tenantId),
        this.getDepartmentProjectStatuses(departmentId, tenantId),
      ]);

      dashboardData = {
        departmentId,
        departmentRevenue,
        departmentExpenses,
        departmentOpenTickets,
        departmentProjectStatuses,
      };
    } else {
      dashboardData = await this.prisma.withTenant(resolved, async (tx) => {
        const [rev, exp, openTickets, projectStatuses] = await Promise.all([
          tx.payment.aggregate({
            _sum: { amount: true },
            where: {
              tenantId: resolved,
              invoice: {
                customer: {
                  createdBy: { departmentId },
                },
              },
            },
          }),
          tx.expense.aggregate({
            _sum: { amount: true },
            where: { tenantId: resolved, departmentId },
          }),
          tx.supportTicket.count({
            where: {
              tenantId: resolved,
              assignedTo: { departmentId },
              status: { notIn: ['CLOSED', 'RESOLVED'] },
            },
          }),
          tx.project.groupBy({
            by: ['status'],
            _count: { id: true },
            where: { tenantId: resolved, createdBy: { departmentId } },
          }),
        ]);

        return {
          departmentId,
          departmentRevenue: rev._sum.amount || 0,
          departmentExpenses: exp._sum.amount || 0,
          departmentOpenTickets: openTickets,
          departmentProjectStatuses: projectStatuses,
        };
      });
    }

    await this.cacheManager.set(cacheKey, dashboardData);
    return dashboardData;
  }

  private async getLeadDashboard(
    departmentId: string,
    userId: string,
    tenantId?: string,
  ) {
    const cacheKey = this.tenantCacheKey(
      `lead-dashboard-${departmentId}-${userId}`,
      tenantId,
    );
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const resolved = tenantId ?? getTenantId();
    let dashboardData: any;

    if (!resolved) {
      const [teamSalesPipeline, teamTaskCompletion, personalTasksDue] =
        await Promise.all([
          this.getTeamSalesPipeline(departmentId, userId, tenantId),
          this.getTeamTaskCompletion(departmentId, tenantId),
          this.getPersonalTasksDue(userId, tenantId),
        ]);

      dashboardData = {
        departmentId,
        userId,
        teamSalesPipeline,
        teamTaskCompletion,
        personalTasksDue,
      };
    } else {
      dashboardData = await this.prisma.withTenant(resolved, async (tx) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [
          teamSalesPipeline,
          totalTasks,
          completedTasks,
          personalTasksDue,
        ] = await Promise.all([
          tx.deal.groupBy({
            by: ['status'],
            _sum: { amount: true },
            _count: { id: true },
            where: {
              tenantId: resolved,
              OR: [{ userId }, { assignedTo: { departmentId } }],
            },
          }),
          tx.task.count({
            where: { tenantId: resolved, assignedTo: { departmentId } },
          }),
          tx.task.count({
            where: {
              tenantId: resolved,
              assignedTo: { departmentId },
              status: 'Completed',
            },
          }),
          tx.task.count({
            where: {
              tenantId: resolved,
              assignedToId: userId,
              status: { notIn: ['Completed', 'Cancelled'] },
              dueDate: { lte: today },
            },
          }),
        ]);

        return {
          departmentId,
          userId,
          teamSalesPipeline,
          teamTaskCompletion:
            totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
          personalTasksDue,
        };
      });
    }

    await this.cacheManager.set(cacheKey, dashboardData);
    return dashboardData;
  }

  private async getStaffDashboard(
    departmentId: string,
    userId: string,
    tenantId?: string,
  ) {
    const cacheKey = this.tenantCacheKey(
      `staff-dashboard-${departmentId}-${userId}`,
      tenantId,
    );
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const resolved = tenantId ?? getTenantId();
    let dashboardData: any;

    if (!resolved) {
      const [personalAttendanceSummary, assignedTickets, myProjectsStatus] =
        await Promise.all([
          this.getPersonalAttendanceSummary(userId, tenantId),
          this.getAssignedTickets(userId, tenantId),
          this.getMyProjectsStatus(userId, tenantId),
        ]);

      dashboardData = {
        departmentId,
        userId,
        personalAttendanceSummary,
        assignedTickets,
        myProjectsStatus,
      };
    } else {
      dashboardData = await this.prisma.withTenant(resolved, async (tx) => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const [personalAttendanceSummary, assignedTickets, myProjectsStatus] =
          await Promise.all([
            tx.attendanceRecord.groupBy({
              by: ['status'],
              _count: { id: true },
              where: {
                tenantId: resolved,
                userId,
                date: { gte: thirtyDaysAgo },
              },
            }),
            tx.supportTicket.findMany({
              where: {
                tenantId: resolved,
                userId,
                status: { notIn: ['CLOSED', 'RESOLVED'] },
              },
              select: { id: true, subject: true, status: true, priority: true },
              orderBy: { createdAt: 'asc' },
            }),
            tx.project.groupBy({
              by: ['status'],
              _count: { id: true },
              where: {
                tenantId: resolved,
                teamMembers: { some: { id: userId } },
              },
            }),
          ]);

        return {
          departmentId,
          userId,
          personalAttendanceSummary,
          assignedTickets,
          myProjectsStatus,
        };
      });
    }

    await this.cacheManager.set(cacheKey, dashboardData);
    return dashboardData;
  }

  // --- KPI Aggregation Methods (Examples - you will implement more) ---

  // Financial KPIs (Admin)
  async getTotalRevenue(tenantId?: string): Promise<number> {
    const result = await this.scoped(tenantId, (db) =>
      db.payment.aggregate({
        _sum: { amount: true },
        where: { ...(tenantId ? { tenantId } : {}) },
      }),
    );
    return result._sum.amount || 0;
  }

  async getTotalExpenses(tenantId?: string): Promise<number> {
    const result = await this.scoped(tenantId, (db) =>
      db.expense.aggregate({
        _sum: { amount: true },
        where: { ...(tenantId ? { tenantId } : {}) },
      }),
    );
    return result._sum.amount || 0;
  }

  async getSalesPipelineSummary(tenantId?: string) {
    return this.scoped(tenantId, (db) =>
      db.deal.groupBy({
        by: ['status'],
        _sum: { amount: true },
        _count: { id: true },
        where: { ...(tenantId ? { tenantId } : {}) },
        orderBy: {
          _sum: {
            amount: 'desc',
          },
        },
      }),
    );
  }

  async getTotalTickets(tenantId?: string): Promise<number> {
    return this.scoped(tenantId, (db) =>
      db.supportTicket.count({
        where: { ...(tenantId ? { tenantId } : {}) },
      }),
    );
  }

  async getTotalOpenTickets(tenantId?: string): Promise<number> {
    return this.scoped(tenantId, (db) =>
      db.supportTicket.count({
        where: {
          ...(tenantId ? { tenantId } : {}),
          status: { notIn: ['CLOSED', 'RESOLVED'] },
        },
      }),
    );
  }

  async getProjectStatuses(tenantId?: string) {
    return this.scoped(tenantId, (db) =>
      db.project.groupBy({
        by: ['status'],
        _count: { id: true },
        where: { ...(tenantId ? { tenantId } : {}) },
        orderBy: {
          _count: {
            id: 'desc',
          },
        },
      }),
    );
  }

  async getSecurityAlertsCount(tenantId?: string): Promise<number> {
    // Assuming 'Notification' model has a 'type' field and 'security' type
    return this.scoped(tenantId, (db) =>
      db.notification.count({
        where: {
          ...(tenantId ? { tenantId } : {}),
          type: 'security',
          read: false,
        }, // Count unread security alerts
      }),
    );
  }

  // --- Department-Specific KPIs (HOD) ---
  async getDepartmentRevenue(
    departmentId: string,
    tenantId?: string,
  ): Promise<number> {
    const result = await this.scoped(tenantId, (db) =>
      db.payment.aggregate({
        _sum: { amount: true },
        where: {
          ...(tenantId ? { tenantId } : {}),
          // Assuming your Payment model is linked to a user, and user to a department
          invoice: {
            customer: {
              // Adjust this filter to match your actual Prisma schema.
              // For example, if 'customer' has a 'user' relation:
              createdBy: {
                departmentId: departmentId, // Assuming User model has a departmentId
              },
              // If 'customer' directly has a departmentId, use:
              // departmentId: departmentId,
            },
          },
          // OR if Payment directly has a departmentId field:
          // departmentId: departmentId
        },
      }),
    );
    return result._sum.amount || 0;
  }

  async getDepartmentExpenses(
    departmentId: string,
    tenantId?: string,
  ): Promise<number> {
    const result = await this.scoped(tenantId, (db) =>
      db.expense.aggregate({
        _sum: { amount: true },
        where: {
          ...(tenantId ? { tenantId } : {}),
          departmentId: departmentId, // Assuming Expense model has a departmentId
        },
      }),
    );
    return result._sum.amount || 0;
  }

  async getDepartmentOpenTickets(
    departmentId: string,
    tenantId?: string,
  ): Promise<number> {
    return this.scoped(tenantId, (db) =>
      db.supportTicket.count({
        where: {
          ...(tenantId ? { tenantId } : {}),
          assignedTo: {
            departmentId: departmentId, // Assuming User model has a departmentId
          },
          // Exclude closed/resolved tickets
          status: { notIn: ['CLOSED', 'RESOLVED'] },
        },
      }),
    );
  }

  async getDepartmentProjectStatuses(departmentId: string, tenantId?: string) {
    return this.scoped(tenantId, (db) =>
      db.project.groupBy({
        by: ['status'],
        _count: { id: true },
        where: {
          ...(tenantId ? { tenantId } : {}),
          createdBy: {
            departmentId: departmentId,
          },
        },
      }),
    );
  }

  // --- Team/Personal KPIs (Lead/Staff) ---
  async getTeamSalesPipeline(
    departmentId: string,
    leadId: string,
    tenantId?: string,
  ) {
    // Assuming Deal has a field for assigned lead/salesperson, and departmentId
    return this.scoped(tenantId, (db) =>
      db.deal.groupBy({
        by: ['status'],
        _sum: { amount: true },
        _count: { id: true },
        where: {
          ...(tenantId ? { tenantId } : {}),
          OR: [
            { userId: leadId }, // Deals directly assigned to the lead
            // Add logic for deals in the lead's team/department if applicable
            {
              // Example: If a deal has a relationship to users in a department
              // AND the users are managed by this lead. This depends heavily on your schema.
              // For simplicity, we'll assume `assignedToId` is sufficient for team/personal scope.
              assignedTo: {
                departmentId: departmentId, // Assuming user.departmentId is stored
              },
            },
          ],
        },
      }),
    );
  }

  async getTeamTaskCompletion(departmentId: string, tenantId?: string) {
    // Assuming Task model exists and can be filtered by assignee/department
    return this.scoped(tenantId, async (db) => {
      const totalTasks = await db.task.count({
        where: {
          ...(tenantId ? { tenantId } : {}),
          assignedTo: { departmentId: departmentId },
        },
      });
      const completedTasks = await db.task.count({
        where: {
          ...(tenantId ? { tenantId } : {}),
          assignedTo: { departmentId: departmentId },
          status: 'Completed',
        },
      });
      return totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
    });
  }

  async getPersonalTasksDue(userId: string, tenantId?: string) {
    // Assuming Task model has a dueDate and assignedToId
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    return this.scoped(tenantId, (db) =>
      db.task.count({
        where: {
          ...(tenantId ? { tenantId } : {}),
          assignedToId: userId,
          status: { notIn: ['Completed', 'Cancelled'] },
          dueDate: { lte: today }, // Tasks due today or overdue
        },
      }),
    );
  }

  async getPersonalAttendanceSummary(userId: string, tenantId?: string) {
    // Example: Count absences/presences in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return this.scoped(tenantId, (db) =>
      db.attendanceRecord.groupBy({
        by: ['status'], // e.g., 'Present', 'Absent', 'Leave'
        _count: { id: true },
        where: {
          ...(tenantId ? { tenantId } : {}),
          userId: userId,
          date: { gte: thirtyDaysAgo },
        },
      }),
    );
  }

  async getAssignedTickets(userId: string, tenantId?: string) {
    // Tickets assigned to a specific staff member
    return this.scoped(tenantId, (db) =>
      db.supportTicket.findMany({
        where: {
          ...(tenantId ? { tenantId } : {}),
          userId: userId,
          status: { notIn: ['CLOSED', 'RESOLVED'] },
        },
        select: { id: true, subject: true, status: true, priority: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async getMyProjectsStatus(userId: string, tenantId?: string) {
    // Projects where the staff member is involved/assigned
    return this.scoped(tenantId, (db) =>
      db.project.groupBy({
        by: ['status'],
        _count: { id: true },
        where: {
          ...(tenantId ? { tenantId } : {}),
          // Assuming Project model has a relation to users or a list of assigned users
          // This might need adjustment based on your Project-User relationship
          teamMembers: {
            some: {
              id: userId,
            },
          },
        },
      }),
    );
  }

  // --- Example for Attendance Chart (filterable by period) ---
  async getAttendanceChart(
    user: {
      role: Role;
      departmentId?: string;
      userId: string;
      tenantId?: string;
    },
    period: 'week' | 'month' | 'year',
  ) {
    // This method needs to be refined based on how you store attendance dates
    // and how you want to aggregate for the chart (e.g., daily presence counts)
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        startDate = new Date(0); // All time or throw error
    }

    // Filter attendance records based on user's role and period
    const whereClause: Record<string, any> = {
      date: { gte: startDate },
    };

    if (user.tenantId) {
      whereClause.tenantId = user.tenantId;
    }

    if (user.role === Role.ADMIN) {
      // No additional user-based filter needed for admin
    } else if (user.role === Role.HOD && user.departmentId) {
      whereClause.user = { departmentId: user.departmentId };
    } else if (
      (user.role === Role.LEAD || user.role === Role.STAFF) &&
      user.userId
    ) {
      whereClause.userId = user.userId;
    } else {
      throw new Error('Insufficient user context for attendance chart.');
    }

    // This is a basic example. For a real chart, you'd likely group by date
    // and then aggregate counts of different statuses (Present, Absent, etc.)
    return this.scoped(user.tenantId, (db) =>
      db.attendanceRecord.groupBy({
        by: ['date', 'status'], // Group by date and status
        _count: { id: true },
        where: whereClause,
        orderBy: { date: 'asc' },
      }),
    );
  }

  // REMINDER: You'll need to add Prisma models and fields for `Task`
  // and ensure `Project` has a relation to `User` for `getMyProjectsStatus`.
  // Also, link `Payment` and `Expense` to departments or users as needed for HOD/Lead/Staff filtering.
}

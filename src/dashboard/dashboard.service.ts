// src/dashboard/dashboard.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { PrismaService } from '../prisma/prisma.service'; // Adjust path if necessary
import { Role } from '@prisma/client'; // Import Role enum from your Prisma client
import { Cache } from 'cache-manager'; // Import Cache type from cache-manager

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache, // Inject NestJS CacheManager
  ) {}

  /**
   * Main method to get dashboard data based on user's role and context.
   */
  async getDashboardData(user: {
    role: Role;
    departmentId?: string;
    userId: string;
  }) {
    switch (user.role) {
      case Role.ADMIN:
        return this.getAdminDashboard();
      case Role.HOD:
        if (!user.departmentId) {
          throw new Error('HOD user must have a departmentId.');
        }
        return this.getHodDashboard(user.departmentId);
      case Role.LEAD:
        if (!user.departmentId || !user.userId) {
          throw new Error('Lead user must have departmentId and userId.');
        }
        return this.getLeadDashboard(user.departmentId, user.userId);
      case Role.STAFF:
        if (!user.departmentId || !user.userId) {
          throw new Error('Staff user must have departmentId and userId.');
        }
        return this.getStaffDashboard(user.departmentId, user.userId);
      default:
        throw new Error('Invalid user role provided.');
    }
  }

  // --- Private Methods for Each Role's Dashboard Data ---

  private async getAdminDashboard() {
    const cacheKey = 'admin-dashboard';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      console.log('Serving admin dashboard from cache.');
      return cachedData;
    }

    // Fetch all admin-level KPIs in parallel
    const [
      totalRevenue,
      totalExpenses,
      salesPipelineSummary,
      totalTickets,
      totalOpenTickets,
      projectStatuses,
      securityAlertsCount,
      // ... add other admin KPIs
    ] = await Promise.all([
      this.getTotalRevenue(),
      this.getTotalExpenses(),
      this.getSalesPipelineSummary(),
      this.getTotalTickets(),
      this.getTotalOpenTickets(),
      this.getProjectStatuses(),
      this.getSecurityAlertsCount(),
      // this.getCashflowSummary(), // Implement this method
      // this.getAttendanceSummary(), // Implement a summary for admin
    ]);

    const dashboardData = {
      totalRevenue,
      totalExpenses,
      salesPipelineSummary,
      totalTickets,
      totalOpenTickets,
      projectStatuses,
      securityAlertsCount,
      // ... include other fetched data
    };

    await this.cacheManager.set(cacheKey, dashboardData); // Cache for 5 mins (default TTL)
    return dashboardData;
  }

  private async getHodDashboard(departmentId: string) {
    const cacheKey = `hod-dashboard-${departmentId}`;
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      console.log(
        `Serving HOD dashboard for department ${departmentId} from cache.`,
      );
      return cachedData;
    }

    // Fetch department-specific KPIs for HOD
    const [
      departmentRevenue,
      departmentExpenses,
      departmentOpenTickets,
      departmentProjectStatuses,
      // ... add other HOD KPIs
    ] = await Promise.all([
      this.getDepartmentRevenue(departmentId),
      this.getDepartmentExpenses(departmentId),
      this.getDepartmentOpenTickets(departmentId),
      this.getDepartmentProjectStatuses(departmentId),
      // this.getDepartmentCashflow(departmentId),
      // this.getDepartmentAttendanceSummary(departmentId),
      // this.getDepartmentBudgetUtilization(departmentId),
    ]);

    const dashboardData = {
      departmentId,
      departmentRevenue,
      departmentExpenses,
      departmentOpenTickets,
      departmentProjectStatuses,
      // ... include other fetched data
    };

    await this.cacheManager.set(cacheKey, dashboardData);
    return dashboardData;
  }

  private async getLeadDashboard(departmentId: string, userId: string) {
    const cacheKey = `lead-dashboard-${departmentId}-${userId}`;
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      console.log(
        `Serving Lead dashboard for user ${userId} in department ${departmentId} from cache.`,
      );
      return cachedData;
    }

    // Fetch Lead-specific KPIs (team-level, personal targets)
    const [
      teamSalesPipeline,
      teamTaskCompletion,
      personalTasksDue,
      // ... add other Lead KPIs
    ] = await Promise.all([
      this.getTeamSalesPipeline(departmentId, userId),
      this.getTeamTaskCompletion(departmentId),
      this.getPersonalTasksDue(userId),
    ]);

    const dashboardData = {
      departmentId,
      userId,
      teamSalesPipeline,
      teamTaskCompletion,
      personalTasksDue,
      // ... include other fetched data
    };

    await this.cacheManager.set(cacheKey, dashboardData);
    return dashboardData;
  }

  private async getStaffDashboard(departmentId: string, userId: string) {
    const cacheKey = `staff-dashboard-${departmentId}-${userId}`;
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      console.log(
        `Serving Staff dashboard for user ${userId} in department ${departmentId} from cache.`,
      );
      return cachedData;
    }

    // Fetch Staff-specific KPIs (personal tasks, attendance)
    const [
      personalAttendanceSummary,
      assignedTickets,
      myProjectsStatus,
      // ... add other Staff KPIs
    ] = await Promise.all([
      this.getPersonalAttendanceSummary(userId),
      this.getAssignedTickets(userId),
      this.getMyProjectsStatus(userId),
    ]);

    const dashboardData = {
      departmentId,
      userId,
      personalAttendanceSummary,
      assignedTickets,
      myProjectsStatus,
      // ... include other fetched data
    };

    await this.cacheManager.set(cacheKey, dashboardData);
    return dashboardData;
  }

  // --- KPI Aggregation Methods (Examples - you will implement more) ---

  // Financial KPIs (Admin)
  async getTotalRevenue(): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      _sum: { amount: true },
    });
    return result._sum.amount || 0;
  }

  async getTotalExpenses(): Promise<number> {
    const result = await this.prisma.expense.aggregate({
      _sum: { amount: true },
    });
    return result._sum.amount || 0;
  }

  async getSalesPipelineSummary() {
    return this.prisma.deal.groupBy({
      by: ['status'],
      _sum: { amount: true },
      _count: { id: true },
      orderBy: {
        _sum: {
          amount: 'desc',
        },
      },
    });
  }

  async getTotalTickets(): Promise<number> {
    return this.prisma.supportTicket.count();
  }

  async getTotalOpenTickets(): Promise<number> {
    return this.prisma.supportTicket.count({
      where: { status: { notIn: ['CLOSED', 'RESOLVED'] } },
    });
  }

  async getProjectStatuses() {
    return this.prisma.project.groupBy({
      by: ['status'],
      _count: { id: true },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
    });
  }

  async getSecurityAlertsCount(): Promise<number> {
    // Assuming 'Notification' model has a 'type' field and 'security' type
    return this.prisma.notification.count({
      where: { type: 'security', read: false }, // Count unread security alerts
    });
  }

  // --- Department-Specific KPIs (HOD) ---
  async getDepartmentRevenue(departmentId: string): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      _sum: { amount: true },
      where: {
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
    });
    return result._sum.amount || 0;
  }

  async getDepartmentExpenses(departmentId: string): Promise<number> {
    const result = await this.prisma.expense.aggregate({
      _sum: { amount: true },
      where: {
        departmentId: departmentId, // Assuming Expense model has a departmentId
      },
    });
    return result._sum.amount || 0;
  }

  async getDepartmentOpenTickets(departmentId: string): Promise<number> {
    return this.prisma.supportTicket.count({
      where: {
        assignedTo: {
          departmentId: departmentId, // Assuming User model has a departmentId
        },
        // Exclude closed/resolved tickets
        status: { notIn: ['CLOSED', 'RESOLVED'] },
      },
    });
  }

  async getDepartmentProjectStatuses(departmentId: string) {
    return this.prisma.project.groupBy({
      by: ['status'],
      _count: { id: true },
      where: {
        createdBy: {
          departmentId: departmentId,
        },
      },
    });
  }

  // --- Team/Personal KPIs (Lead/Staff) ---
  async getTeamSalesPipeline(departmentId: string, leadId: string) {
    // Assuming Deal has a field for assigned lead/salesperson, and departmentId
    return this.prisma.deal.groupBy({
      by: ['status'],
      _sum: { amount: true },
      _count: { id: true },
      where: {
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
    });
  }

  async getTeamTaskCompletion(departmentId: string) {
    // Assuming Task model exists and can be filtered by assignee/department
    const totalTasks = await this.prisma.task.count({
      where: { assignedTo: { departmentId: departmentId } },
    });
    const completedTasks = await this.prisma.task.count({
      where: {
        assignedTo: { departmentId: departmentId },
        status: 'Completed',
      },
    });
    return totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
  }

  async getPersonalTasksDue(userId: string) {
    // Assuming Task model has a dueDate and assignedToId
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    return this.prisma.task.count({
      where: {
        assignedToId: userId,
        status: { notIn: ['Completed', 'Cancelled'] },
        dueDate: { lte: today }, // Tasks due today or overdue
      },
    });
  }

  async getPersonalAttendanceSummary(userId: string) {
    // Example: Count absences/presences in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return await this.prisma.attendanceRecord.groupBy({
      by: ['status'], // e.g., 'Present', 'Absent', 'Leave'
      _count: { id: true },
      where: {
        userId: userId,
        date: { gte: thirtyDaysAgo },
      },
    });
  }

  async getAssignedTickets(userId: string) {
    // Tickets assigned to a specific staff member
    return this.prisma.supportTicket.findMany({
      where: {
        userId: userId,
        status: { notIn: ['CLOSED', 'RESOLVED'] },
      },
      select: { id: true, subject: true, status: true, priority: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getMyProjectsStatus(userId: string) {
    // Projects where the staff member is involved/assigned
    return this.prisma.project.groupBy({
      by: ['status'],
      _count: { id: true },
      where: {
        // Assuming Project model has a relation to users or a list of assigned users
        // This might need adjustment based on your Project-User relationship
        teamMembers: {
          some: {
            id: userId,
          },
        },
      },
    });
  }

  // --- Example for Attendance Chart (filterable by period) ---
  async getAttendanceChart(
    user: { role: Role; departmentId?: string; userId: string },
    period: 'week' | 'month' | 'year',
  ) {
    console.log('User role in getAttendanceChart:', user.role);
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

    if (user.role === Role.ADMIN) {
      console.log('User is ADMIN, no additional user-based filter applied.');
      // No additional user-based filter needed for admin
    } else if (user.role === Role.HOD && user.departmentId) {
      console.log('User is HOD, filtering by departmentId:', user.departmentId);
      whereClause.user = { departmentId: user.departmentId };
    } else if (
      (user.role === Role.LEAD || user.role === Role.STAFF) &&
      user.userId
    ) {
      console.log('User is LEAD/STAFF, filtering by userId:', user.userId);
      whereClause.userId = user.userId;
    } else {
      console.error(
        'Insufficient user context for attendance chart. Falling into else block.',
      ); 
      throw new Error('Insufficient user context for attendance chart.');
    }

    // This is a basic example. For a real chart, you'd likely group by date
    // and then aggregate counts of different statuses (Present, Absent, etc.)
    return await this.prisma.attendanceRecord.groupBy({
      by: ['date', 'status'], // Group by date and status
      _count: { id: true },
      where: whereClause,
      orderBy: { date: 'asc' },
    });
  }

  // REMINDER: You'll need to add Prisma models and fields for `Task`
  // and ensure `Project` has a relation to `User` for `getMyProjectsStatus`.
  // Also, link `Payment` and `Expense` to departments or users as needed for HOD/Lead/Staff filtering.
}

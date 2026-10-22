import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import {
  DashboardWidgetsService,
  WidgetRequestUser,
} from './dashboard-widgets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // Adjust path if necessary
import { RolesGuard } from '../auth/guards/roles.guard'; // Adjust path if necessary
import { Roles } from '../auth/decorators/roles.decorator'; // Adjust path if necessary
import { User } from '../auth/decorators/user.decorator'; // Your custom User decorator
import { Role } from '@prisma/client'; // Import Role enum from your Prisma client

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard) // Apply guards to all endpoints in this controller
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly widgetsService: DashboardWidgetsService,
  ) {}

  /**
   * Main endpoint to get dashboard data based on the authenticated user's role.
   * Accessible by Admin, HOD, Lead, and Staff roles.
   */
  @Get()
  @Roles(Role.ADMIN, Role.HOD, Role.LEAD, Role.STAFF)
  async getDashboard(
    @User()
    user: {
      role: Role;
      departmentId?: string;
      userId: string;
      tenantId?: string;
    },
  ) {
    return this.dashboardService.getDashboardData(user);
  }

  /**
   * Widget payload for the dashboard views.
   *
   * Returns real, tenant-scoped data for every widget the dashboard renders.
   * The scope is derived from the caller's role (ADMIN → organization,
   * HOD → department, LEAD → team, STAFF → individual) so the client never
   * has to guess which slice of data it is allowed to see.
   */
  @Get('widgets')
  @Roles(Role.ADMIN, Role.HOD, Role.LEAD, Role.STAFF)
  async getWidgets(
    @User()
    user: {
      id: string;
      userId: string;
      role: Role;
      tenantId?: string;
      departmentId?: string;
      managedDepartmentId?: string;
    },
  ) {
    const requestUser: WidgetRequestUser = {
      id: user.userId ?? user.id,
      role: user.role,
      tenantId: user.tenantId,
      departmentId: user.departmentId,
      managedDepartmentId: user.managedDepartmentId,
    };

    return this.widgetsService.buildForUser(requestUser);
  }

  /**
   * Endpoint to get attendance chart data, filterable by period.
   * Accessible by Admin, HOD, Lead, and Staff roles.
   */
  @Get('attendance-chart')
  @Roles(Role.ADMIN, Role.HOD, Role.LEAD, Role.STAFF)
  async getAttendanceChart(
    @User()
    user: {
      role: Role;
      departmentId?: string;
      userId: string;
      tenantId?: string;
    },
    @Query('period') period: 'week' | 'month' | 'year',
  ) {
    if (!period || !['week', 'month', 'year'].includes(period)) {
      // You might want to throw a BadRequestException or use a DTO with validation
      throw new Error(
        'Invalid or missing period parameter. Must be "week", "month", or "year".',
      );
    }
    return this.dashboardService.getAttendanceChart(user, period);
  }
}

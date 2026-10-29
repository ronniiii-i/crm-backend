import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import {
  DashboardWidgetsService,
  WidgetRequestUser,
} from './dashboard-widgets.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/decorators/user.decorator';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly widgetsService: DashboardWidgetsService,
  ) {}

  /**
   * Main endpoint to get dashboard data based on the authenticated user's
   * role/data-scope.  Access is controlled by JwtAuthGuard + global guards.
   */
  @Get()
  async getDashboard(
    @User()
    user: {
      dataScope?: string;
      isTenantAdmin?: boolean;
      departmentId?: string;
      userId?: string;
      id?: string;
      sub?: string;
      tenantId?: string;
    },
  ) {
    return this.dashboardService.getDashboardData(user);
  }

  /**
   * Widget payload for the dashboard views.
   *
   * Returns real, tenant-scoped data for every widget the dashboard renders.
   * The scope is derived from the caller's dataScope (TENANT → organization,
   * DEPARTMENT → department, TEAM → team, SELF → individual) so the client
   * never has to guess which slice of data it is allowed to see.
   */
  @Get('widgets')
  getWidgets(
    @User()
    user: {
      id?: string;
      userId?: string;
      sub?: string;
      dataScope?: string;
      isTenantAdmin?: boolean;
      tenantId?: string;
      departmentId?: string;
      managedDepartmentId?: string;
    },
  ) {
    const requestUser: WidgetRequestUser = {
      id: user.id ?? user.userId ?? user.sub ?? '',
      dataScope: user.dataScope,
      isTenantAdmin: user.isTenantAdmin,
      tenantId: user.tenantId,
      departmentId: user.departmentId,
      managedDepartmentId: user.managedDepartmentId,
    };

    return this.widgetsService.buildForUser(requestUser);
  }

  /**
   * Endpoint to get attendance chart data, filterable by period.
   */
  @Get('attendance-chart')
  async getAttendanceChart(
    @User()
    user: {
      dataScope?: string;
      isTenantAdmin?: boolean;
      departmentId?: string;
      userId?: string;
      id?: string;
      sub?: string;
      tenantId?: string;
    },
    @Query('period') period: 'week' | 'month' | 'year',
  ) {
    if (!period || !['week', 'month', 'year'].includes(period)) {
      throw new Error(
        'Invalid or missing period parameter. Must be "week", "month", or "year".',
      );
    }
    return this.dashboardService.getAttendanceChart(user, period);
  }
}

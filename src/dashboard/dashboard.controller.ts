// src/dashboard/dashboard.controller.ts
import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // Adjust path if necessary
import { RolesGuard } from '../auth/guards/roles.guard'; // Adjust path if necessary
import { Roles } from '../auth/decorators/roles.decorator'; // Adjust path if necessary
import { User } from '../auth/decorators/user.decorator'; // Your custom User decorator
import { Role } from '@prisma/client'; // Import Role enum from your Prisma client

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard) // Apply guards to all endpoints in this controller
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Main endpoint to get dashboard data based on the authenticated user's role.
   * Accessible by Admin, HOD, Lead, and Staff roles.
   */
  @Get()
  @Roles(Role.ADMIN, Role.HOD, Role.LEAD, Role.STAFF)
  async getDashboard(
    @User() user: { role: Role; departmentId?: string; userId: string },
  ) {
    return this.dashboardService.getDashboardData(user);
  }

  /**
   * Endpoint to get attendance chart data, filterable by period.
   * Accessible by Admin, HOD, Lead, and Staff roles.
   */
  @Get('attendance-chart')
  @Roles(Role.ADMIN, Role.HOD, Role.LEAD, Role.STAFF)
  async getAttendanceChart(
    @User() user: { role: Role; departmentId?: string; userId: string },
    @Query('period') period: 'week' | 'month' | 'year',
  ) {
    console.log('--- Request hit DashboardController.getAttendanceChart ---');
    if (!period || !['week', 'month', 'year'].includes(period)) {
      // You might want to throw a BadRequestException or use a DTO with validation
      throw new Error(
        'Invalid or missing period parameter. Must be "week", "month", or "year".',
      );
    }
    return this.dashboardService.getAttendanceChart(user, period);
  }

  // You can add more specific endpoints here if a KPI requires unique parameters
  // e.g., @Get('project-details/:projectId')
}

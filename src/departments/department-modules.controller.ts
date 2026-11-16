import { Body, Controller, Headers, Ip, Param, Post } from '@nestjs/common';
import { TenantAdminOnly } from '../auth/decorators/tenant-admin.decorator';
import { User } from '../auth/decorators/user.decorator';
import { ProvisionModulesDto } from './dto/provision-modules.dto';
import { DepartmentsService } from './departments.service';

/**
 * Idempotent module provisioning for an existing department.
 *
 * Lives on the `workspace` prefix because the plan defines the route as
 * `POST /workspace/departments/:deptId/modules`, while the service stays in the
 * departments domain.
 */
@Controller('workspace/departments')
@TenantAdminOnly()
export class DepartmentModulesController {
  constructor(private readonly service: DepartmentsService) {}

  @Post(':deptId/modules')
  provision(
    @User() user: any,
    @Param('deptId') deptId: string,
    @Body() dto: ProvisionModulesDto,
    @Ip() ip?: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.service.provisionModules(
      user.tenantId,
      deptId,
      dto.moduleTemplates,
      {
        actorId: user.id,
        ip,
        userAgent,
        requestId,
      },
    );
  }
}

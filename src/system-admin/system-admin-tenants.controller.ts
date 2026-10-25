import { Controller, Get, Param, Patch, Post, Query, UseGuards, Req } from '@nestjs/common';
import { SystemAdminGuard } from './guards/system-admin.guard';
import { SystemAdminRoute } from '../auth/decorators/system-admin-route.decorator';
import { SystemAdminTenantsService } from './system-admin-tenants.service';

@Controller('system-admin/tenants')
@UseGuards(SystemAdminGuard)
@SystemAdminRoute()
export class SystemAdminTenantsController {
  constructor(private readonly service: SystemAdminTenantsService) {}

  @Get()
  list(@Query() query: any) {
    return this.service.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id/lifecycle')
  updateLifecycle(@Param('id') id: string, @Req() req: any) {
    return this.service.updateLifecycle(id, req.body, req.user);
  }

  @Post(':id/extend-trial')
  extendTrial(@Param('id') id: string, @Req() req: any) {
    return this.service.extendTrial(id, req.body?.days ?? 0, req.user);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string, @Req() req: any) {
    return this.service.updateLifecycle(id, { status: 'ACTIVE' }, req.user);
  }

  @Post(':id/suspend')
  suspend(@Param('id') id: string, @Req() req: any) {
    return this.service.updateLifecycle(id, { status: 'SUSPENDED', reason: req.body?.reason }, req.user);
  }

  @Post(':id/reactivate')
  reactivate(@Param('id') id: string, @Req() req: any) {
    return this.service.updateLifecycle(id, { status: 'ACTIVE' }, req.user);
  }
}

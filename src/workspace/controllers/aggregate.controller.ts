import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentModuleAccess } from '../decorators/module-access.decorator';
import { RequireModuleAction } from '../decorators/module-action.decorator';
import { ModulePermissionGuard } from '../guards/module-permission.guard';
import { AggregationService } from '../services/aggregation.service';
import { ResolvedModuleAccess } from '../services/module-access.service';

/** Batched dashboard widgets (max 12) with per-widget error isolation. */
@Controller('workspace/modules/:deptKey/:moduleKey/aggregate')
@UseGuards(ModulePermissionGuard)
export class AggregateController {
  constructor(private readonly aggregation: AggregationService) {}

  @Post()
  @RequireModuleAction('VIEW')
  run(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Body() body: unknown,
  ) {
    return this.aggregation.run(access, body);
  }
}

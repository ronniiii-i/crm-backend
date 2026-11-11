import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentModuleAccess } from '../decorators/module-access.decorator';
import { RequireModuleAction } from '../decorators/module-action.decorator';
import { ModulePermissionGuard } from '../guards/module-permission.guard';
import { RateLimit } from '../../rate-limit/rate-limit.decorator';
import { ResolvedModuleAccess } from '../services/module-access.service';
import { LookupService } from '../lookups/lookup.service';

/** Scoped relation dropdown options for one allowlisted FK field. */
@Controller('workspace/modules/:deptKey/:moduleKey/lookups')
@UseGuards(ModulePermissionGuard)
export class LookupsController {
  constructor(private readonly lookups: LookupService) {}

  @Get(':field')
  @RequireModuleAction('VIEW')
  @RateLimit({ policy: 'lookups' })
  lookup(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('field') field: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.lookups.lookup(access, field, query);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentModuleAccess } from '../decorators/module-access.decorator';
import { RequireModuleAction } from '../decorators/module-action.decorator';
import { ModulePermissionGuard } from '../guards/module-permission.guard';
import { EntityQueryService } from '../services/entity-query.service';
import { EntityWriteService } from '../services/entity-write.service';
import { ResolvedModuleAccess } from '../services/module-access.service';

/** Allowlisted CRUD for a module's target entity. */
@Controller('workspace/modules/:deptKey/:moduleKey/records')
@UseGuards(ModulePermissionGuard)
export class RecordsController {
  constructor(
    private readonly queries: EntityQueryService,
    private readonly writes: EntityWriteService,
  ) {}

  @Get()
  @RequireModuleAction('VIEW')
  list(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Query() query: Record<string, unknown>,
  ) {
    return this.queries.list(access, query);
  }

  @Get(':id')
  @RequireModuleAction('VIEW')
  findOne(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
  ) {
    return this.queries.getOne(access, id);
  }

  @Post()
  @RequireModuleAction('CREATE')
  create(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Body() body: Record<string, unknown>,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.writes.create(access, body, { ip, userAgent });
  }

  @Patch(':id')
  @RequireModuleAction('EDIT')
  update(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.writes.update(access, id, body, { ip, userAgent });
  }

  @Delete(':id')
  @RequireModuleAction('DELETE')
  remove(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.writes.remove(access, id, { ip, userAgent });
  }

  @Post(':id/transition')
  @RequireModuleAction('EDIT')
  transition(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.writes.transition(access, id, body, { ip, userAgent });
  }
}

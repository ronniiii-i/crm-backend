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

  @Get('assignees')
  @RequireModuleAction('VIEW')
  assignees(@CurrentModuleAccess() access: ResolvedModuleAccess) {
    return this.writes.listAssignees(access);
  }

  @Get(':id')
  @RequireModuleAction('VIEW')
  findOne(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
  ) {
    return this.queries.getOne(access, id);
  }

  @Post(':id/reassign')
  @RequireModuleAction('EDIT')
  reassign(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.writes.reassign(access, id, body, {
      ip,
      userAgent,
      requestId,
    });
  }

  @Post()
  @RequireModuleAction('CREATE')
  create(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Body() body: Record<string, unknown>,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.writes.create(access, body, { ip, userAgent, requestId });
  }

  @Patch(':id')
  @RequireModuleAction('EDIT')
  update(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.writes.update(access, id, body, { ip, userAgent, requestId });
  }

  @Delete(':id')
  @RequireModuleAction('DELETE')
  remove(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
    @Query('hard') hard?: string,
    @Ip() ip?: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.writes.remove(
      access,
      id,
      { ip, userAgent, requestId },
      { hard: hard === 'true' || hard === '1' },
    );
  }

  @Post(':id/transition')
  @RequireModuleAction('EDIT')
  transition(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.writes.transition(access, id, body, {
      ip,
      userAgent,
      requestId,
    });
  }
}

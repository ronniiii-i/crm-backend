import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentModuleAccess } from '../decorators/module-access.decorator';
import { RequireModuleAction } from '../decorators/module-action.decorator';
import { ModulePermissionGuard } from '../guards/module-permission.guard';
import { ResolvedModuleAccess } from '../services/module-access.service';
import { LeaveWorkflowService } from '../services/leave-workflow.service';

/**
 * Leave approval workflow routes.
 *
 * The generic records endpoint keeps serving list/read (scope-filtered); every
 * mutation is funnelled through the state machine here so attendance,
 * approvers, audit and notifications stay consistent.
 */
@Controller('workspace/modules/:deptKey/:moduleKey/leave-requests')
@UseGuards(ModulePermissionGuard)
export class LeaveController {
  constructor(private readonly leave: LeaveWorkflowService) {}

  @Post()
  @RequireModuleAction(['CREATE', 'EDIT'])
  create(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.leave.create(access, (body ?? {}) as Record<string, unknown>, {
      ip,
      userAgent,
      requestId,
    });
  }

  @Post(':id/transition')
  @RequireModuleAction(['CREATE', 'EDIT'])
  transition(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.leave.transition(
      access,
      id,
      (body ?? {}) as Record<string, unknown>,
      { ip, userAgent, requestId },
    );
  }

  @Get(':id/timeline')
  @RequireModuleAction('VIEW')
  timeline(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
  ) {
    return this.leave.timeline(access, id);
  }
}

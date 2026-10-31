import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentModuleAccess } from '../decorators/module-access.decorator';
import { RequireModuleAction } from '../decorators/module-action.decorator';
import { ModulePermissionGuard } from '../guards/module-permission.guard';
import { FormSubmissionService } from '../services/form-submission.service';
import { ResolvedModuleAccess } from '../services/module-access.service';

/** Form builder submissions, with optional entity mirroring. */
@Controller('workspace/modules/:deptKey/:moduleKey/submissions')
@UseGuards(ModulePermissionGuard)
export class SubmissionsController {
  constructor(private readonly submissions: FormSubmissionService) {}

  @Get()
  @RequireModuleAction('VIEW')
  list(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Query() query: Record<string, unknown>,
  ) {
    return this.submissions.list(access, query);
  }

  @Post()
  @RequireModuleAction('CREATE')
  submit(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.submissions.submit(access, body, { ip, userAgent });
  }
}

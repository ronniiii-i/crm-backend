import {
  Controller,
  Get,
  Headers,
  Ip,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentModuleAccess } from '../decorators/module-access.decorator';
import { RequireModuleAction } from '../decorators/module-action.decorator';
import { ModulePermissionGuard } from '../guards/module-permission.guard';
import { ResolvedModuleAccess } from '../services/module-access.service';
import { ExportService } from './export.service';

/** Full filtered-set CSV export for a module's target entity. */
@Controller('workspace/modules/:deptKey/:moduleKey/export')
@UseGuards(ModulePermissionGuard)
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Get()
  @RequireModuleAction('VIEW')
  async export(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
    @Ip() ip?: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<void> {
    await this.exports.stream(access, query, res, {
      ip,
      userAgent,
      requestId,
    });
  }
}

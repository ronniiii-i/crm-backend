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
import { DocumentService } from '../services/document.service';
import { ResolvedModuleAccess } from '../services/module-access.service';

/** Document hub list/CRUD. Deletes archive unless `hard=true` (tenant admin). */
@Controller('workspace/modules/:deptKey/:moduleKey/documents')
@UseGuards(ModulePermissionGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentService) {}

  @Get()
  @RequireModuleAction('VIEW')
  list(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Query() query: Record<string, unknown>,
  ) {
    return this.documents.list(access, query);
  }

  @Get(':id')
  @RequireModuleAction('VIEW')
  findOne(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
  ) {
    return this.documents.getOne(access, id);
  }

  @Post()
  @RequireModuleAction('CREATE')
  create(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.documents.create(access, body, { ip, userAgent });
  }

  @Patch(':id')
  @RequireModuleAction('EDIT')
  update(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.documents.update(access, id, body, { ip, userAgent });
  }

  @Delete(':id')
  @RequireModuleAction('DELETE')
  remove(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
    @Query('hard') hard: string | undefined,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.documents.remove(
      access,
      id,
      { hard: hard === 'true' || hard === '1' },
      { ip, userAgent },
    );
  }
}

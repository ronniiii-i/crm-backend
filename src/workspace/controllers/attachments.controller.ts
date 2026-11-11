import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentModuleAccess } from '../decorators/module-access.decorator';
import { RequireModuleAction } from '../decorators/module-action.decorator';
import { RegisterAttachmentDto } from '../dto/register-attachment.dto';
import { ModulePermissionGuard } from '../guards/module-permission.guard';
import { AttachmentService } from '../services/attachment.service';
import { ResolvedModuleAccess } from '../services/module-access.service';

/** Record attachments. Feature-gated by `ATTACHMENTS_ENABLED`. */
@Controller('workspace/modules/:deptKey/:moduleKey/records/:id/attachments')
@UseGuards(ModulePermissionGuard)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentService) {}

  @Get()
  @RequireModuleAction('VIEW')
  list(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
  ) {
    return this.attachments.list(access, id);
  }

  @Post()
  @RequireModuleAction('EDIT')
  create(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
    @Body() dto: RegisterAttachmentDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.attachments.create(access, id, dto, { ip, userAgent });
  }

  @Delete(':attachmentId')
  @RequireModuleAction('EDIT')
  remove(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.attachments.remove(access, id, attachmentId, {
      ip,
      userAgent,
    });
  }
}

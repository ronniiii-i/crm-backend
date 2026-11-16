import {
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { TenantAdminOnly } from '../../auth/decorators/tenant-admin.decorator';
import { User } from '../../auth/decorators/user.decorator';
import { TrashService } from '../services/trash.service';

/**
 * Tenant-admin recovery for soft-deleted business records.
 *
 * The entity allowlist lives in `soft-delete.ts`; users, roles, departments,
 * modules and audit rows are never reachable here.
 */
@Controller('workspace/trash')
@TenantAdminOnly()
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @Get()
  list(@User() user: any, @Query() query: Record<string, unknown>) {
    return this.trash.list(user.tenantId, query);
  }

  @Post(':entity/:id/restore')
  restore(
    @User() user: any,
    @Param('entity') entity: string,
    @Param('id') id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.trash.restore(user.tenantId, entity, id, {
      actorId: user.id,
      requestId,
    });
  }

  @Delete(':entity/:id')
  purge(
    @User() user: any,
    @Param('entity') entity: string,
    @Param('id') id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.trash.purge(user.tenantId, entity, id, {
      actorId: user.id,
      requestId,
    });
  }
}

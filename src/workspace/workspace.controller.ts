import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentModuleAccess } from './decorators/module-access.decorator';
import { RequireModuleAction } from './decorators/module-action.decorator';
import { parseConfigBody } from './dto/module-config.dto';
import { ModulePermissionGuard } from './guards/module-permission.guard';
import { AuditService } from './services/audit.service';
import {
  ModuleAccessService,
  ResolvedModuleAccess,
} from './services/module-access.service';
import { ModuleConfigService } from './services/module-config.service';

/**
 * Module definition and renderer configuration.
 *
 * `GET` returns everything a renderer needs in one round trip: config, the
 * caller's actions and effective data scope, and entity metadata.
 */
@Controller('workspace')
@UseGuards(ModulePermissionGuard)
export class WorkspaceController {
  constructor(
    private readonly access: ModuleAccessService,
    private readonly configs: ModuleConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('modules/:deptKey/:moduleKey')
  @RequireModuleAction('VIEW')
  definition(@CurrentModuleAccess() access: ResolvedModuleAccess) {
    return this.access.definition(access);
  }

  @Patch('modules/:deptKey/:moduleKey/config')
  @RequireModuleAction('EDIT')
  async updateConfig(
    @CurrentModuleAccess() access: ResolvedModuleAccess,
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    this.access.assertTenantAdmin(access);

    const config = this.configs.validate(
      access.module.type,
      parseConfigBody(body),
    );

    await this.prisma.withTenant(access.actor.tenantId, async (tx) => {
      const before = access.module.config;

      await tx.module.update({
        where: { id: access.module.id },
        data: { config: config as unknown as Prisma.InputJsonValue },
      });

      await this.audit.record(tx, null, {
        tenantId: access.actor.tenantId,
        departmentId: access.module.departmentId ?? null,
        actorId: access.actor.id,
        action: 'UPDATE_CONFIG',
        entity: 'modules',
        entityId: access.module.id,
        before: { config: before } as Record<string, unknown>,
        after: { config: config as unknown as Record<string, unknown> },
        ip,
        userAgent,
      });
    });

    return { config };
  }
}

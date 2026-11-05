import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AggregateController } from './controllers/aggregate.controller';
import { CatalogController } from './controllers/catalog.controller';
import { DocumentsController } from './controllers/documents.controller';
import { RecordsController } from './controllers/records.controller';
import { SubmissionsController } from './controllers/submissions.controller';
import { ModulePermissionGuard } from './guards/module-permission.guard';
import { AggregationService } from './services/aggregation.service';
import { AuditService } from './services/audit.service';
import { DocumentService } from './services/document.service';
import { EntityQueryService } from './services/entity-query.service';
import { EntityRegistryService } from './services/entity-registry.service';
import { EntityWriteService } from './services/entity-write.service';
import { FormSubmissionService } from './services/form-submission.service';
import { ModuleAccessService } from './services/module-access.service';
import { ModuleConfigService } from './services/module-config.service';
import { ScopeFilterService } from './services/scope-filter.service';
import { WorkspaceController } from './workspace.controller';

/**
 * Dynamic workspace API.
 *
 * Every route resolves the module from `(department key, module key)` and
 * authorises it through `ModulePermissionGuard`. Business entities are only
 * reachable through the server-side allowlist in `entities/entity-registry`.
 */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [
    WorkspaceController,
    RecordsController,
    AggregateController,
    DocumentsController,
    SubmissionsController,
    CatalogController,
  ],
  providers: [
    EntityRegistryService,
    ScopeFilterService,
    ModuleConfigService,
    ModuleAccessService,
    AuditService,
    EntityQueryService,
    EntityWriteService,
    AggregationService,
    DocumentService,
    FormSubmissionService,
    ModulePermissionGuard,
  ],
  exports: [
    EntityRegistryService,
    ScopeFilterService,
    ModuleAccessService,
    ModuleConfigService,
    EntityQueryService,
    EntityWriteService,
  ],
})
export class WorkspaceModule {}

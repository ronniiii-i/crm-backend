import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { AggregateController } from './controllers/aggregate.controller';
import { AttachmentsController } from './controllers/attachments.controller';
import { CatalogController } from './controllers/catalog.controller';
import { DocumentsController } from './controllers/documents.controller';
import { LeaveController } from './controllers/leave.controller';
import { LookupsController } from './controllers/lookups.controller';
import { RecordsController } from './controllers/records.controller';
import { SubmissionsController } from './controllers/submissions.controller';
import { ModulePermissionGuard } from './guards/module-permission.guard';
import { LookupService } from './lookups/lookup.service';
import { AggregationService } from './services/aggregation.service';
import { AttachmentService } from './services/attachment.service';
import { AuditService } from './services/audit.service';
import { DocumentService } from './services/document.service';
import { EntityQueryService } from './services/entity-query.service';
import { EntityRegistryService } from './services/entity-registry.service';
import { EntityWriteService } from './services/entity-write.service';
import { FormSubmissionService } from './services/form-submission.service';
import { LeaveWorkflowService } from './services/leave-workflow.service';
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
  imports: [AuthModule, PrismaModule, StorageModule],
  controllers: [
    WorkspaceController,
    RecordsController,
    AttachmentsController,
    AggregateController,
    DocumentsController,
    SubmissionsController,
    CatalogController,
    LookupsController,
    LeaveController,
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
    AttachmentService,
    DocumentService,
    FormSubmissionService,
    LeaveWorkflowService,
    LookupService,
    ModulePermissionGuard,
  ],
  exports: [
    EntityRegistryService,
    ScopeFilterService,
    ModuleAccessService,
    ModuleConfigService,
    EntityQueryService,
    EntityWriteService,
    AuditService,
  ],
})
export class WorkspaceModule {}

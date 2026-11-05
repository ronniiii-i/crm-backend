-- ===========================================================================
-- Phase 3: Dynamic composition engine
-- ===========================================================================
-- Adds module renderer metadata, custom-field extensibility, document hub,
-- form submissions, and audit logs. Also canonicalises department module
-- paths to /dept/<departmentKey>/<moduleKey> and extends tenant RLS to the
-- new tables.
--
-- This migration is applied by the database owner. The runtime `crm_app`
-- role only receives the grants and RLS policies defined at the bottom.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "ModuleType" AS ENUM ('DASHBOARD_VIEW', 'DATA_TABLE', 'KANBAN_BOARD', 'DOCUMENT_HUB', 'FORM_BUILDER');
CREATE TYPE "DocumentFormat" AS ENUM ('MARKDOWN', 'RICH_TEXT');
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- ---------------------------------------------------------------------------
-- Extensibility: custom fields (JSONB)
-- ---------------------------------------------------------------------------
ALTER TABLE "Contact" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Deal" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Expense" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "InventoryItem" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Invoice" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "SupportTicket" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Task" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- Module renderer metadata
-- ---------------------------------------------------------------------------
ALTER TABLE "modules"
  ADD COLUMN "config" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "dataScope" "RoleDataScope",
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "targetEntity" TEXT,
  ADD COLUMN "type" "ModuleType" NOT NULL DEFAULT 'DATA_TABLE',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------------
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "departmentId" TEXT,
    "moduleId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "format" "DocumentFormat" NOT NULL DEFAULT 'MARKDOWN',
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "category" TEXT,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "form_submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "entityId" TEXT,
    "submittedById" TEXT,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "departmentId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX "documents_tenantId_moduleId_idx" ON "documents"("tenantId", "moduleId");
CREATE INDEX "documents_tenantId_departmentId_idx" ON "documents"("tenantId", "departmentId");
CREATE UNIQUE INDEX "documents_tenantId_slug_key" ON "documents"("tenantId", "slug");

CREATE INDEX "form_submissions_tenantId_moduleId_idx" ON "form_submissions"("tenantId", "moduleId");
CREATE INDEX "form_submissions_tenantId_submittedById_idx" ON "form_submissions"("tenantId", "submittedById");

CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");
CREATE INDEX "audit_logs_tenantId_entity_entityId_idx" ON "audit_logs"("tenantId", "entity", "entityId");
CREATE INDEX "audit_logs_tenantId_departmentId_idx" ON "audit_logs"("tenantId", "departmentId");

CREATE INDEX "modules_tenantId_type_idx" ON "modules"("tenantId", "type");
CREATE INDEX "modules_tenantId_departmentId_order_idx" ON "modules"("tenantId", "departmentId", "order");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data backfill: renderer type and target entity for the Phase 2 catalogue
-- ---------------------------------------------------------------------------
UPDATE "modules"
SET "type" = CASE "key"
  -- Workspace
  WHEN 'dashboard' THEN 'DASHBOARD_VIEW'::"ModuleType"
  WHEN 'departments' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'user-management' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'settings' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'invitations' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'roles' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'billing' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'notifications' THEN 'DATA_TABLE'::"ModuleType"
  -- Finance
  WHEN 'invoices' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'payments' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'expense-tracking' THEN 'FORM_BUILDER'::"ModuleType"
  WHEN 'budget-management' THEN 'DASHBOARD_VIEW'::"ModuleType"
  WHEN 'financial-reports' THEN 'DASHBOARD_VIEW'::"ModuleType"
  -- Information Technology
  WHEN 'asset-management' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'ticketing-issue-tracking' THEN 'KANBAN_BOARD'::"ModuleType"
  WHEN 'system-monitoring' THEN 'DASHBOARD_VIEW'::"ModuleType"
  WHEN 'software-licenses' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'support-requests' THEN 'FORM_BUILDER'::"ModuleType"
  -- Sales
  WHEN 'leads-management' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'opportunities-deals' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'contacts' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'sales-pipeline' THEN 'KANBAN_BOARD'::"ModuleType"
  WHEN 'quotes-proposals' THEN 'DOCUMENT_HUB'::"ModuleType"
  WHEN 'sales-reports' THEN 'DASHBOARD_VIEW'::"ModuleType"
  -- Customer Support
  WHEN 'support-tickets' THEN 'KANBAN_BOARD'::"ModuleType"
  WHEN 'knowledge-base' THEN 'DOCUMENT_HUB'::"ModuleType"
  WHEN 'customer-feedback' THEN 'FORM_BUILDER'::"ModuleType"
  WHEN 'sla-management' THEN 'DOCUMENT_HUB'::"ModuleType"
  WHEN 'live-chat-communication' THEN 'FORM_BUILDER'::"ModuleType"
  -- Human Resources
  WHEN 'employee-records' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'attendance-leave-management' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'recruitment-job-postings' THEN 'FORM_BUILDER'::"ModuleType"
  WHEN 'performance-reviews' THEN 'FORM_BUILDER'::"ModuleType"
  WHEN 'payroll' THEN 'DASHBOARD_VIEW'::"ModuleType"
  -- Administration
  WHEN 'document-management' THEN 'DOCUMENT_HUB'::"ModuleType"
  WHEN 'meeting-scheduler' THEN 'FORM_BUILDER'::"ModuleType"
  WHEN 'company-announcements' THEN 'DOCUMENT_HUB'::"ModuleType"
  WHEN 'compliance-policies' THEN 'DOCUMENT_HUB'::"ModuleType"
  WHEN 'vendor-management' THEN 'DATA_TABLE'::"ModuleType"
  -- Operations
  WHEN 'project-management' THEN 'KANBAN_BOARD'::"ModuleType"
  WHEN 'inventory-management' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'workflow-automation' THEN 'FORM_BUILDER'::"ModuleType"
  WHEN 'resource-allocation' THEN 'DATA_TABLE'::"ModuleType"
  WHEN 'reporting-analytics' THEN 'DASHBOARD_VIEW'::"ModuleType"
  ELSE "type"
END
WHERE "key" IN (
  'dashboard','departments','user-management','settings','invitations','roles','billing','notifications',
  'invoices','payments','expense-tracking','budget-management','financial-reports',
  'asset-management','ticketing-issue-tracking','system-monitoring','software-licenses','support-requests',
  'leads-management','opportunities-deals','contacts','sales-pipeline','quotes-proposals','sales-reports',
  'support-tickets','knowledge-base','customer-feedback','sla-management','live-chat-communication',
  'employee-records','attendance-leave-management','recruitment-job-postings','performance-reviews','payroll',
  'document-management','meeting-scheduler','company-announcements','compliance-policies','vendor-management',
  'project-management','inventory-management','workflow-automation','resource-allocation','reporting-analytics'
);

UPDATE "modules"
SET "targetEntity" = CASE "key"
  WHEN 'departments' THEN 'users'
  WHEN 'user-management' THEN 'users'
  WHEN 'invoices' THEN 'invoices'
  WHEN 'payments' THEN 'invoices'
  WHEN 'expense-tracking' THEN 'expenses'
  WHEN 'budget-management' THEN 'expenses'
  WHEN 'financial-reports' THEN 'invoices'
  WHEN 'asset-management' THEN 'inventory_items'
  WHEN 'ticketing-issue-tracking' THEN 'support_tickets'
  WHEN 'system-monitoring' THEN 'support_tickets'
  WHEN 'software-licenses' THEN 'inventory_items'
  WHEN 'support-requests' THEN 'support_tickets'
  WHEN 'leads-management' THEN 'contacts'
  WHEN 'opportunities-deals' THEN 'deals'
  WHEN 'contacts' THEN 'contacts'
  WHEN 'sales-pipeline' THEN 'deals'
  WHEN 'sales-reports' THEN 'deals'
  WHEN 'support-tickets' THEN 'support_tickets'
  WHEN 'employee-records' THEN 'users'
  WHEN 'attendance-leave-management' THEN 'attendance_records'
  WHEN 'payroll' THEN 'expenses'
  WHEN 'vendor-management' THEN 'contacts'
  WHEN 'project-management' THEN 'tasks'
  WHEN 'inventory-management' THEN 'inventory_items'
  WHEN 'resource-allocation' THEN 'users'
  WHEN 'reporting-analytics' THEN 'deals'
  ELSE "targetEntity"
END
WHERE "key" IN (
  'departments','user-management','invoices','payments','expense-tracking','budget-management','financial-reports',
  'asset-management','ticketing-issue-tracking','system-monitoring','software-licenses','support-requests',
  'leads-management','opportunities-deals','contacts','sales-pipeline','sales-reports','support-tickets',
  'employee-records','attendance-leave-management','payroll','vendor-management','project-management',
  'inventory-management','resource-allocation','reporting-analytics'
);

-- Department modules become navigable now that every one has a renderer.
UPDATE "modules" SET "isNavigable" = true WHERE "departmentId" IS NOT NULL;

-- Canonical dynamic route: /dept/<departmentKey>/<moduleKey>
UPDATE "modules" m
SET "path" = '/dept/' || d."key" || '/' || m."key"
FROM "Department" d
WHERE m."departmentId" = d."id";

-- ---------------------------------------------------------------------------
-- RLS and grants for the new tenant-owned tables
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "documents",
  "form_submissions",
  "audit_logs"
TO crm_app;

DO $do$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'documents',
    'form_submissions',
    'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I TO crm_app USING ("tenantId" = current_setting(''app.current_tenant'', true)) WITH CHECK ("tenantId" = current_setting(''app.current_tenant'', true))',
      tenant_table
    );
  END LOOP;
END
$do$;

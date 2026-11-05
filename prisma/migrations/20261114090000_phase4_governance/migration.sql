-- ===========================================================================
-- Phase 4 Stage 1 - Governance: soft deletes and attachments
-- ===========================================================================
-- Additive only. Adds recoverable deletes to business entities and the object
-- metadata table used by record attachments (avatars ship in Stage 6).
--
-- Users, roles, modules, departments and audit rows are intentionally excluded
-- from soft delete: they keep their existing lifecycle rules.

-- ---------------------------------------------------------------------------
-- Soft deletes on business entities
-- ---------------------------------------------------------------------------
ALTER TABLE "Contact" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Project" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Task" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

ALTER TABLE "InventoryItem" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Invoice" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Expense" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Deal" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

ALTER TABLE "SupportTicket" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

ALTER TABLE "documents" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

CREATE INDEX "Contact_tenantId_deletedAt_idx" ON "Contact"("tenantId", "deletedAt");
CREATE INDEX "Project_tenantId_deletedAt_idx" ON "Project"("tenantId", "deletedAt");
CREATE INDEX "Task_tenantId_deletedAt_idx" ON "Task"("tenantId", "deletedAt");
CREATE INDEX "InventoryItem_tenantId_deletedAt_idx" ON "InventoryItem"("tenantId", "deletedAt");
CREATE INDEX "Invoice_tenantId_deletedAt_idx" ON "Invoice"("tenantId", "deletedAt");
CREATE INDEX "Expense_tenantId_deletedAt_idx" ON "Expense"("tenantId", "deletedAt");
CREATE INDEX "Deal_tenantId_deletedAt_idx" ON "Deal"("tenantId", "deletedAt");
CREATE INDEX "SupportTicket_tenantId_deletedAt_idx" ON "SupportTicket"("tenantId", "deletedAt");
CREATE INDEX "documents_tenantId_deletedAt_idx" ON "documents"("tenantId", "deletedAt");

-- ---------------------------------------------------------------------------
-- Attachment metadata
-- ---------------------------------------------------------------------------
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "moduleId" TEXT,
    "key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attachments_tenantId_entity_entityId_idx"
  ON "attachments"("tenantId", "entity", "entityId");
CREATE INDEX "attachments_tenantId_deletedAt_idx"
  ON "attachments"("tenantId", "deletedAt");

ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "modules"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "attachments" TO crm_app;

DO $do$
BEGIN
  ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON "attachments";
  CREATE POLICY tenant_isolation ON "attachments"
    TO crm_app
    USING ("tenantId" = current_setting('app.current_tenant', true))
    WITH CHECK ("tenantId" = current_setting('app.current_tenant', true));
END
$do$;

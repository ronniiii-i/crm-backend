-- ===========================================================================
-- Rollback for Phase 3 dynamic composition migration.
-- ===========================================================================
-- WARNING: destructive for Phase 3-created content (documents, form
-- submissions, audit logs) and for module renderer metadata. Take a backup
-- before running this against any environment that matters.
--
-- Run this manually; Prisma has no built-in down migrations.

-- ---------------------------------------------------------------------------
-- Restore legacy department module paths before dropping renderer metadata.
-- ---------------------------------------------------------------------------
UPDATE "modules" m
SET "path" = CASE d."key"
  WHEN 'information_technology' THEN '/it/' || m."key"
  WHEN 'human_resources' THEN '/hr/' || m."key"
  WHEN 'customer_support' THEN '/customer-support/' || m."key"
  ELSE '/' || d."key" || '/' || m."key"
END
FROM "Department" d
WHERE m."departmentId" = d."id"
  AND m."path" LIKE '/dept/%';

-- The Phase 2 catalogue only marked workspace modules as navigable.
UPDATE "modules" SET "isNavigable" = false WHERE "departmentId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Drop RLS-protected Phase 3 tables (indexes and policies go with them).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "audit_logs";
DROP TABLE IF EXISTS "form_submissions";
DROP TABLE IF EXISTS "documents";

-- ---------------------------------------------------------------------------
-- Drop module metadata columns.
-- ---------------------------------------------------------------------------
ALTER TABLE "modules"
  DROP COLUMN IF EXISTS "updatedAt",
  DROP COLUMN IF EXISTS "type",
  DROP COLUMN IF EXISTS "targetEntity",
  DROP COLUMN IF EXISTS "isActive",
  DROP COLUMN IF EXISTS "dataScope",
  DROP COLUMN IF EXISTS "config";

DROP INDEX IF EXISTS "modules_tenantId_type_idx";
DROP INDEX IF EXISTS "modules_tenantId_departmentId_order_idx";

-- ---------------------------------------------------------------------------
-- Drop custom fields.
-- ---------------------------------------------------------------------------
ALTER TABLE "Task" DROP COLUMN IF EXISTS "customFields";
ALTER TABLE "SupportTicket" DROP COLUMN IF EXISTS "customFields";
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "customFields";
ALTER TABLE "InventoryItem" DROP COLUMN IF EXISTS "customFields";
ALTER TABLE "Expense" DROP COLUMN IF EXISTS "customFields";
ALTER TABLE "Deal" DROP COLUMN IF EXISTS "customFields";
ALTER TABLE "Contact" DROP COLUMN IF EXISTS "customFields";

-- ---------------------------------------------------------------------------
-- Drop enums.
-- ---------------------------------------------------------------------------
DROP TYPE IF EXISTS "DocumentStatus";
DROP TYPE IF EXISTS "DocumentFormat";
DROP TYPE IF EXISTS "ModuleType";

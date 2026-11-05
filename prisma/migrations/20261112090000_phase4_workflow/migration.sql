-- ===========================================================================
-- Phase 4 Stage 1 - Leave workflow persistence
-- ===========================================================================
-- Additive only. Introduces the two-stage leave request state machine storage
-- and links the attendance ledger to the request that produced it.
--
-- PostgreSQL 12+ allows `ALTER TYPE ... ADD VALUE` inside a transaction as
-- long as the new value is not used in the same transaction. This migration
-- only declares it; the module-config backfill that uses WORKFLOW runs later
-- in `prisma/backfill-phase4.ts`.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'CASUAL', 'UNPAID', 'PARENTAL', 'OTHER');
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING_TEAM_LEAD', 'PENDING_HR', 'APPROVED', 'REJECTED', 'CANCELLED');

ALTER TYPE "ModuleType" ADD VALUE 'WORKFLOW';

-- ---------------------------------------------------------------------------
-- Leave requests
-- ---------------------------------------------------------------------------
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL DEFAULT 'ANNUAL',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING_TEAM_LEAD',
    "currentStage" INTEGER NOT NULL DEFAULT 1,
    "teamLeadId" TEXT,
    "hodId" TEXT,
    "hrApproverId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leave_requests_tenantId_userId_status_idx"
  ON "leave_requests"("tenantId", "userId", "status");
CREATE INDEX "leave_requests_tenantId_status_createdAt_idx"
  ON "leave_requests"("tenantId", "status", "createdAt");
CREATE INDEX "leave_requests_tenantId_startDate_endDate_idx"
  ON "leave_requests"("tenantId", "startDate", "endDate");
CREATE INDEX "leave_requests_tenantId_deletedAt_idx"
  ON "leave_requests"("tenantId", "deletedAt");

ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_teamLeadId_fkey"
  FOREIGN KEY ("teamLeadId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_hodId_fkey"
  FOREIGN KEY ("hodId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_hrApproverId_fkey"
  FOREIGN KEY ("hrApproverId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Attendance ledger linkage and soft delete
-- ---------------------------------------------------------------------------
ALTER TABLE "AttendanceRecord"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT,
  ADD COLUMN "leaveRequestId" TEXT;

-- Deduplicate before enforcing one ledger row per user/day. Keeps the most
-- recently created row and breaks ties deterministically by id.
DELETE FROM "AttendanceRecord" a
USING "AttendanceRecord" b
WHERE a."tenantId" = b."tenantId"
  AND a."userId" = b."userId"
  AND a."date" = b."date"
  AND (a."createdAt" < b."createdAt"
       OR (a."createdAt" = b."createdAt" AND a."id" < b."id"));

CREATE INDEX "AttendanceRecord_tenantId_leaveRequestId_idx"
  ON "AttendanceRecord"("tenantId", "leaveRequestId");
CREATE INDEX "AttendanceRecord_tenantId_deletedAt_idx"
  ON "AttendanceRecord"("tenantId", "deletedAt");
CREATE UNIQUE INDEX "AttendanceRecord_tenantId_userId_date_key"
  ON "AttendanceRecord"("tenantId", "userId", "date");

ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_leaveRequestId_fkey"
  FOREIGN KEY ("leaveRequestId") REFERENCES "leave_requests"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "leave_requests" TO crm_app;

DO $do$
BEGIN
  ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "leave_requests" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON "leave_requests";
  CREATE POLICY tenant_isolation ON "leave_requests"
    TO crm_app
    USING ("tenantId" = current_setting('app.current_tenant', true))
    WITH CHECK ("tenantId" = current_setting('app.current_tenant', true));
END
$do$;

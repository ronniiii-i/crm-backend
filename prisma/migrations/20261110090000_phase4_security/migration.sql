-- ===========================================================================
-- Phase 4 Stage 1 - Security and platform persistence
-- ===========================================================================
-- Additive only. Every new column is nullable or has a safe default, so no
-- existing row is rewritten and no application query breaks before the
-- matching service changes ship.
--
-- Contains:
--   * workspace formatting preferences on `tenants`
--   * notification transport metadata (link, metadata, dedupeKey, readAt)
--   * audit correlation columns (moduleKey, requestId)
--   * role inheritance (`roles.parentRoleId`) and role-level revokes
--   * `user_sessions` (active device sessions)
--   * `notification_preferences`
--   * grants and RLS policies for the new tenant tables

-- ---------------------------------------------------------------------------
-- Workspace preferences
-- ---------------------------------------------------------------------------
ALTER TABLE "tenants" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN "currencySymbol" TEXT,
ADD COLUMN "dateFormat" TEXT NOT NULL DEFAULT 'd MMM yyyy',
ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en-US',
ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN "weekStartsOn" INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- Notification transport and idempotency
-- ---------------------------------------------------------------------------
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT,
ADD COLUMN "link" TEXT,
ADD COLUMN "metadata" JSONB,
ADD COLUMN "readAt" TIMESTAMP(3);

CREATE INDEX "Notification_tenantId_userId_read_createdAt_idx"
  ON "Notification"("tenantId", "userId", "read", "createdAt");
CREATE UNIQUE INDEX "Notification_tenantId_userId_dedupeKey_key"
  ON "Notification"("tenantId", "userId", "dedupeKey");

-- ---------------------------------------------------------------------------
-- Audit correlation
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_logs" ADD COLUMN "moduleKey" TEXT,
ADD COLUMN "requestId" TEXT;

CREATE INDEX "audit_logs_tenantId_moduleKey_createdAt_idx"
  ON "audit_logs"("tenantId", "moduleKey", "createdAt");

-- ---------------------------------------------------------------------------
-- Role inheritance and explicit revokes
-- ---------------------------------------------------------------------------
ALTER TABLE "role_module_permissions"
  ADD COLUMN "effect" "PermissionEffect" NOT NULL DEFAULT 'GRANT';
ALTER TABLE "roles" ADD COLUMN "parentRoleId" TEXT;

CREATE INDEX "role_module_permissions_tenantId_roleId_effect_idx"
  ON "role_module_permissions"("tenantId", "roleId", "effect");
CREATE INDEX "roles_tenantId_parentRoleId_idx"
  ON "roles"("tenantId", "parentRoleId");

ALTER TABLE "roles" ADD CONSTRAINT "roles_parentRoleId_fkey"
  FOREIGN KEY ("parentRoleId") REFERENCES "roles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Active sessions
-- ---------------------------------------------------------------------------
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "deviceLabel" TEXT,
    "fingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_sessions_tenantId_userId_revokedAt_idx"
  ON "user_sessions"("tenantId", "userId", "revokedAt");
CREATE INDEX "user_sessions_tenantId_expiresAt_idx"
  ON "user_sessions"("tenantId", "expiresAt");

ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Notification preferences
-- ---------------------------------------------------------------------------
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_preferences_tenantId_userId_type_key"
  ON "notification_preferences"("tenantId", "userId", "type");

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS and grants for the new tenant-owned tables
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "user_sessions",
  "notification_preferences"
TO crm_app;

-- Audit rows are append-only. The Phase 3 migration granted UPDATE/DELETE for
-- simplicity; Phase 4 revokes them so application code can never rewrite
-- history, even through a compromised service.
REVOKE UPDATE, DELETE ON TABLE "audit_logs" FROM crm_app;
GRANT SELECT, INSERT ON TABLE "audit_logs" TO crm_app;

DO $do$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'user_sessions',
    'notification_preferences'
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

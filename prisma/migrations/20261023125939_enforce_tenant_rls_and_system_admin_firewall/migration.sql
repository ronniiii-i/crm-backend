-- ===========================================================================
-- Phase 2 tenant isolation and system-admin firewall
-- ===========================================================================
-- This migration is intentionally split into two concerns:
--   1. Database roles and grants (who can touch which table).
--   2. Row-level security (which tenant rows a role can see).
--
-- The runtime application connects as crm_app. The isolated system-admin
-- service connects as crm_system. Migrations and seeding run as the database
-- owner, which retains BYPASSRLS and is never used by the application.

-- ---------------------------------------------------------------------------
-- Runtime roles
-- ---------------------------------------------------------------------------
-- Passwords are intentionally absent. Set them out of band with
-- prisma/sql/roles.sql (or an equivalent secret-management step).

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app
      LOGIN
      NOINHERIT
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_system') THEN
    CREATE ROLE crm_system
      LOGIN
      NOINHERIT
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS;
  END IF;

  -- SUPERUSER and BYPASSRLS are superuser-only attributes. Guard existing
  -- roles instead of attempting an ALTER that a CREATEROLE owner cannot run.
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'crm_app'
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'crm_app must not have SUPERUSER or BYPASSRLS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'crm_system'
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'crm_system must not have SUPERUSER or BYPASSRLS';
  END IF;
END
$do$;

ALTER ROLE crm_app
  WITH LOGIN
       NOINHERIT
       NOCREATEDB
       NOCREATEROLE;

ALTER ROLE crm_system
  WITH LOGIN
       NOINHERIT
       NOCREATEDB
       NOCREATEROLE;

-- ---------------------------------------------------------------------------
-- Schema and table grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM crm_app, crm_system;
GRANT USAGE ON SCHEMA public TO crm_app, crm_system;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM crm_app, crm_system;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM crm_app, crm_system;

-- Global permission catalogue: read-only for the tenant application.
GRANT SELECT ON TABLE "permissions" TO crm_app;

-- Tenant registry: the application can create a workspace, read its tenant,
-- and update tenant state. It cannot delete tenants.
GRANT SELECT, INSERT, UPDATE ON TABLE "tenants" TO crm_app;

-- Tenant-owned business and configuration tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "users",
  "Contact",
  "Project",
  "Task",
  "Department",
  "InventoryItem",
  "Notification",
  "ProjectFile",
  "ProjectMember",
  "blacklisted_tokens",
  "Invoice",
  "Payment",
  "Expense",
  "Deal",
  "SupportTicket",
  "AttendanceRecord",
  "QuickAction",
  "modules",
  "role_module_permissions",
  "teams",
  "team_members",
  "permission_overrides",
  "permission_groups",
  "permission_group_items",
  "permission_group_assignments",
  "roles",
  "invitations"
TO crm_app;

GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO crm_app;

-- System-admin runtime: only platform metadata. No tenant business tables.
GRANT SELECT, UPDATE ON TABLE "tenants" TO crm_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "system_admins",
  "tenant_lifecycle_events"
TO crm_system;

-- ---------------------------------------------------------------------------
-- Row-level security: tenant tables
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'users',
    'Contact',
    'Project',
    'Task',
    'Department',
    'InventoryItem',
    'Notification',
    'ProjectFile',
    'ProjectMember',
    'blacklisted_tokens',
    'Invoice',
    'Payment',
    'Expense',
    'Deal',
    'SupportTicket',
    'AttendanceRecord',
    'QuickAction',
    'modules',
    'role_module_permissions',
    'teams',
    'team_members',
    'permission_overrides',
    'permission_groups',
    'permission_group_items',
    'permission_group_assignments',
    'roles',
    'invitations'
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

-- The tenant registry is keyed by id rather than tenantId.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "tenants";
CREATE POLICY tenant_isolation ON "tenants"
  TO crm_app
  USING (id = current_setting('app.current_tenant', true))
  WITH CHECK (id = current_setting('app.current_tenant', true));

DROP POLICY IF EXISTS system_tenant_access ON "tenants";
CREATE POLICY system_tenant_access ON "tenants"
  TO crm_system
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Row-level security: system-admin tables
-- ---------------------------------------------------------------------------
ALTER TABLE "system_admins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "system_admins" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_admin_access ON "system_admins";
CREATE POLICY system_admin_access ON "system_admins"
  TO crm_system
  USING (true)
  WITH CHECK (true);

ALTER TABLE "tenant_lifecycle_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_lifecycle_events" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_admin_access ON "tenant_lifecycle_events";
CREATE POLICY system_admin_access ON "tenant_lifecycle_events"
  TO crm_system
  USING (true)
  WITH CHECK (true);

-- NOTE: permissions is global and intentionally has no RLS.

-- ---------------------------------------------------------------------------
-- Database-level invariants
-- ---------------------------------------------------------------------------
-- Exactly one Tenant Admin role per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS roles_one_tenant_admin_per_tenant
  ON "roles" ("tenantId")
  WHERE "isTenantAdmin" = true;

-- At most one pending invitation per normalized email per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS invitations_one_pending_per_email
  ON "invitations" ("tenantId", lower(email))
  WHERE status = 'PENDING';

-- Every permission-group assignment targets exactly one user or department.
ALTER TABLE "permission_group_assignments"
  ADD CONSTRAINT "permission_group_assignments_target_check"
  CHECK (num_nonnulls("userId", "departmentId") = 1);

-- ---------------------------------------------------------------------------
-- Public, minimal lookup functions
-- ---------------------------------------------------------------------------
-- Authentication and workspace onboarding resolve the tenant by host slug
-- before any tenant context exists. These functions expose only the minimum
-- public metadata and never return tenant business data.

DROP FUNCTION IF EXISTS auth_lookup_user(text);
DROP FUNCTION IF EXISTS auth_lookup_tenant_by_email(text);
DROP FUNCTION IF EXISTS auth_lookup_tenant_by_token(text, text);
DROP FUNCTION IF EXISTS auth_lookup_tenant_by_user_id(text);
DROP FUNCTION IF EXISTS auth_lookup_default_tenant();

CREATE OR REPLACE FUNCTION public.public_workspace_lookup(p_slug text)
RETURNS TABLE (
  id text,
  name text,
  slug text,
  status text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
STRICT
SET search_path = public, pg_temp
AS $function$
  SELECT t.id, t.name, t.slug, t.status::text
  FROM "tenants" t
  WHERE t.slug = p_slug
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.public_workspace_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_workspace_lookup(text) TO crm_app;

CREATE OR REPLACE FUNCTION public.tenant_slug_available(p_slug text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
STRICT
SET search_path = public, pg_temp
AS $function$
  SELECT NOT EXISTS (
    SELECT 1
    FROM "tenants" t
    WHERE t.slug = p_slug
  );
$function$;

REVOKE ALL ON FUNCTION public.tenant_slug_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_slug_available(text) TO crm_app;

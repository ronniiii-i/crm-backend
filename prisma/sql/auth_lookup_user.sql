-- ===========================================================================
-- Authentication lookup helpers (SECURITY DEFINER)
-- ===========================================================================
-- Login / signup / email-verification / password-reset all happen BEFORE a
-- tenant context exists, so the application cannot rely on RLS to find the
-- user (with no `app.current_tenant` the users policy matches zero rows).
--
-- These SECURITY DEFINER functions perform narrowly scoped, read-only lookups
-- across tenants for authentication only. They are owned by the migration role;
-- PUBLIC execute is revoked and granted only to crm_app.

DROP FUNCTION IF EXISTS auth_lookup_user(text);

-- Resolve a user (and their tenant) by email address.
CREATE OR REPLACE FUNCTION auth_lookup_user(p_email text)
RETURNS TABLE (
  id text,
  email text,
  "tenantId" text,
  "isVerified" boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.email, u."tenantId", u."isVerified"
  FROM users u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_lookup_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO crm_app;

-- Resolve the tenant that owns an email address (used at signup to detect an
-- existing account before creating one).
CREATE OR REPLACE FUNCTION auth_lookup_tenant_by_email(p_email text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u."tenantId"
  FROM users u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_lookup_tenant_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_tenant_by_email(text) TO crm_app;

-- Resolve the tenant that owns a user identified by a one-time token stored in
-- one of the given columns (verifyToken / resetToken).
CREATE OR REPLACE FUNCTION auth_lookup_tenant_by_token(p_column text, p_token text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant text;
BEGIN
  IF p_column NOT IN ('verifyToken', 'resetToken') THEN
    RAISE EXCEPTION 'unsupported token column: %', p_column;
  END IF;

  EXECUTE format(
    'SELECT "tenantId" FROM users WHERE %I = $1 LIMIT 1',
    p_column
  )
  INTO v_tenant
  USING p_token;

  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION auth_lookup_tenant_by_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_tenant_by_token(text, text) TO crm_app;

-- Resolve the tenant that owns a user by user id (used to scope post-auth
-- operations that only carry the user id, e.g. JWT validation fallbacks).
CREATE OR REPLACE FUNCTION auth_lookup_tenant_by_user_id(p_user_id text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u."tenantId"
  FROM users u
  WHERE u.id = p_user_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_lookup_tenant_by_user_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_tenant_by_user_id(text) TO crm_app;

-- Resolve the tenant id of the first (and, in the single-tenant default setup,
-- only) tenant. Used by signup to attach self-registered users to the default
-- tenant when no tenant context is available.
CREATE OR REPLACE FUNCTION auth_lookup_default_tenant()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id
  FROM tenants t
  WHERE t.status = 'ACTIVE'
  ORDER BY t."createdAt" ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_lookup_default_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_default_tenant() TO crm_app;

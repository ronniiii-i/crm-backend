-- ===========================================================================
-- Public lookup helpers (SECURITY DEFINER)
-- ===========================================================================
-- Login, invitation acceptance, and workspace onboarding all happen before a
-- tenant context exists. They resolve the workspace by host slug through these
-- narrowly scoped functions, then perform all tenant-scoped reads inside
-- PrismaService.withTenant.
--
-- These functions are owned by the migration role and rely on that role's
-- BYPASSRLS attribute. They expose only public workspace metadata.

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

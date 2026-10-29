-- ===========================================================================
-- Runtime role bootstrap (owner-only)
-- ===========================================================================
-- Run this after the security migration whenever passwords need to be set or
-- rotated. It is deliberately not a Prisma migration so secrets never enter
-- migration history.
--
-- PowerShell example:
--   psql $env:DIRECT_URL `
--     -v crm_app_password="$env:CRM_APP_PASSWORD" `
--     -v crm_system_password="$env:CRM_SYSTEM_PASSWORD" `
--     -f prisma/sql/roles.sql
--
-- bash example:
--   psql "$DIRECT_URL" \
--     -v crm_app_password="$CRM_APP_PASSWORD" \
--     -v crm_system_password="$CRM_SYSTEM_PASSWORD" \
--     -f prisma/sql/roles.sql

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

\if :{?crm_app_password}
ALTER ROLE crm_app WITH PASSWORD :'crm_app_password';
\endif

\if :{?crm_system_password}
ALTER ROLE crm_system WITH PASSWORD :'crm_system_password';
\endif

-- =====================================================================
-- Creates the least-privilege application role.
--
-- This is NOT optional. The application must connect as a role WITHOUT
-- BYPASSRLS, or every row-level security policy in db/schema.sql is inert
-- and tenant isolation is a comment rather than a control.
--
-- Superusers and table owners bypass RLS. Connecting the app as one is the
-- single easiest way to ship a cross-tenant data leak while every test
-- passes.
--
-- Usage:
--   psql "$ADMIN_DATABASE_URL" -v app_password="'...'" -f scripts/create-app-role.sql
-- =====================================================================

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'safesphere_app') THEN
    EXECUTE 'CREATE ROLE safesphere_app LOGIN NOBYPASSRLS';
  END IF;
END $$;

ALTER ROLE safesphere_app WITH PASSWORD :app_password NOBYPASSRLS;

GRANT USAGE ON SCHEMA public, app TO safesphere_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO safesphere_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO safesphere_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO safesphere_app;

-- Anything created by a later migration must inherit the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO safesphere_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO safesphere_app;

-- The audit trail is append-only for the application.
REVOKE UPDATE, DELETE ON audit_events FROM safesphere_app;

-- Materialized views are refreshed by the scheduled job, which connects as
-- this role; refreshing requires ownership, so hand them over.
ALTER MATERIALIZED VIEW mv_incident_daily OWNER TO safesphere_app;
ALTER MATERIALIZED VIEW mv_action_daily   OWNER TO safesphere_app;

DO $$
DECLARE bypasses boolean;
BEGIN
  SELECT rolbypassrls INTO bypasses FROM pg_roles WHERE rolname = 'safesphere_app';
  IF bypasses THEN
    RAISE EXCEPTION 'safesphere_app has BYPASSRLS — tenant isolation would be inert.';
  END IF;
  RAISE NOTICE 'safesphere_app created: NOBYPASSRLS confirmed.';
END $$;

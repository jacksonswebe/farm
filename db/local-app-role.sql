-- Local development only.
--
-- The postgres Docker image creates POSTGRES_USER as a superuser, and
-- superusers bypass row-level security. Connecting the app as that user
-- locally would mean tenant isolation is silently off on every developer's
-- machine — so the one bug class the design most needs to catch would never
-- appear until production.
--
-- This creates the same NOBYPASSRLS role the deployed environments use, with
-- a fixed local password so the connection string in docs/10 always works.
-- Applied automatically by docker/compose.yml after the schema and seed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'safesphere_app') THEN
    EXECUTE 'CREATE ROLE safesphere_app LOGIN NOBYPASSRLS';
  END IF;
END $$;

ALTER ROLE safesphere_app WITH PASSWORD 'localdev' NOBYPASSRLS;

GRANT USAGE ON SCHEMA public, app TO safesphere_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO safesphere_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO safesphere_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO safesphere_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO safesphere_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO safesphere_app;

REVOKE UPDATE, DELETE ON audit_events FROM safesphere_app;

ALTER MATERIALIZED VIEW mv_incident_daily OWNER TO safesphere_app;
ALTER MATERIALIZED VIEW mv_action_daily   OWNER TO safesphere_app;

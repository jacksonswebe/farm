-- =====================================================================
-- SafeSphere EHS — PostgreSQL 16 schema
-- Canonical DDL. prisma/schema.prisma mirrors this file.
--
-- Conventions
--   * UUID v4 primary keys (gen_random_uuid from pgcrypto)
--   * Every tenant-owned table carries organization_id NOT NULL + RLS
--   * timestamptz everywhere; the application stores UTC and renders in
--     the site's IANA timezone
--   * Records are never destroyed: status transitions, not deletes.
--     deleted_at exists only where a user may genuinely remove content.
--   * Naming: snake_case, plural tables, singular columns
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ---------------------------------------------------------------------
-- 0. Tenant context helper (used by every RLS policy)
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid
$$;

COMMENT ON FUNCTION app.current_org() IS
  'Returns the org id set by withTenant(). NULL when unset, which makes every RLS policy fail closed.';

-- ---------------------------------------------------------------------
-- 1. Enumerated types
-- ---------------------------------------------------------------------
CREATE TYPE plan_tier          AS ENUM ('TRIAL','STARTER','PROFESSIONAL','ENTERPRISE');
CREATE TYPE subscription_status AS ENUM ('TRIALING','ACTIVE','PAST_DUE','READ_ONLY','CANCELLED');

CREATE TYPE org_role           AS ENUM (
  'ORG_ADMIN','HSE_MANAGER','INVESTIGATOR','SITE_MANAGER',
  'ACTION_OWNER','EMPLOYEE','EXECUTIVE','AUDITOR');

CREATE TYPE report_type        AS ENUM ('INCIDENT','NEAR_MISS','HAZARD','OBSERVATION');
CREATE TYPE report_status      AS ENUM (
  'DRAFT','SUBMITTED','ACKNOWLEDGED','INVESTIGATING',
  'ACTIONS_PENDING','PENDING_CLOSURE','CLOSED','REJECTED','DUPLICATE');
CREATE TYPE source_channel     AS ENUM ('WEB','MOBILE_PWA','WHATSAPP','ANONYMOUS_LINK','IMPORT','API');

CREATE TYPE severity_level     AS ENUM ('NEGLIGIBLE','MINOR','MODERATE','MAJOR','CATASTROPHIC');
CREATE TYPE likelihood_level   AS ENUM ('RARE','UNLIKELY','POSSIBLE','LIKELY','ALMOST_CERTAIN');
CREATE TYPE risk_band          AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');

CREATE TYPE person_involvement AS ENUM ('INVOLVED','INJURED','WITNESS','FIRST_RESPONDER','SUPERVISOR');
CREATE TYPE treatment_level    AS ENUM ('NONE','FIRST_AID','MEDICAL_TREATMENT','HOSPITALISATION','FATALITY');

CREATE TYPE investigation_status AS ENUM (
  'ASSIGNED','IN_PROGRESS','SUBMITTED','RETURNED','APPROVED','CANCELLED');
CREATE TYPE finding_type       AS ENUM ('IMMEDIATE_CAUSE','UNDERLYING_CAUSE','ROOT_CAUSE','OBSERVATION');
CREATE TYPE root_cause_category AS ENUM (
  'PEOPLE','PROCESS','EQUIPMENT','ENVIRONMENT','MANAGEMENT_SYSTEM','EXTERNAL');

CREATE TYPE action_type        AS ENUM ('CORRECTIVE','PREVENTIVE');
CREATE TYPE action_status      AS ENUM (
  'OPEN','IN_PROGRESS','PENDING_VERIFICATION','VERIFIED_CLOSED','REJECTED','CANCELLED');
CREATE TYPE hierarchy_of_control AS ENUM (
  'ELIMINATION','SUBSTITUTION','ENGINEERING','ADMINISTRATIVE','PPE');
CREATE TYPE effectiveness_rating AS ENUM ('EFFECTIVE','PARTIALLY_EFFECTIVE','NOT_EFFECTIVE');
CREATE TYPE priority_level     AS ENUM ('LOW','MEDIUM','HIGH','URGENT');

CREATE TYPE taxonomy_kind      AS ENUM (
  'INCIDENT_CATEGORY','INJURY_TYPE','BODY_PART','WORK_AREA','EQUIPMENT_TYPE','ACTION_TAG');

CREATE TYPE attachment_status  AS ENUM ('PENDING','UPLOADED','QUARANTINED','FAILED');
CREATE TYPE entity_type        AS ENUM (
  'ORGANIZATION','USER','SITE','DEPARTMENT','INCIDENT','INVESTIGATION','FINDING',
  'ROOT_CAUSE','ACTION','ATTACHMENT','COMMENT','EXPORT','NOTIFICATION','SUBSCRIPTION');

CREATE TYPE notification_channel AS ENUM ('IN_APP','EMAIL','WHATSAPP','SMS');
CREATE TYPE delivery_status    AS ENUM ('QUEUED','SENT','DELIVERED','FAILED','SUPPRESSED');
CREATE TYPE notification_category AS ENUM (
  'REPORT_SUBMITTED','REPORT_ACKNOWLEDGED','INVESTIGATION_ASSIGNED','INVESTIGATION_DUE',
  'INVESTIGATION_SUBMITTED','INVESTIGATION_RETURNED','ACTION_ASSIGNED','ACTION_DUE',
  'ACTION_OVERDUE','ACTION_ESCALATED','ACTION_VERIFICATION','INCIDENT_CLOSED',
  'WEEKLY_DIGEST','SYSTEM');

CREATE TYPE audit_action       AS ENUM (
  'CREATE','UPDATE','DELETE','STATUS_CHANGE','ASSIGN','APPROVE','REJECT',
  'LOGIN','LOGOUT','EXPORT','VIEW_SENSITIVE','PERMISSION_CHANGE');

CREATE TYPE ai_feature         AS ENUM (
  'SUMMARIZE_REPORT','SUGGEST_CLASSIFICATION','SUGGEST_WHY','SUGGEST_ACTIONS',
  'EXEC_NARRATIVE','DUPLICATE_DETECTION');
CREATE TYPE ai_outcome         AS ENUM ('SHOWN','ACCEPTED','EDITED','REJECTED','FAILED');

CREATE TYPE export_format      AS ENUM ('CSV','XLSX','PDF');
CREATE TYPE export_status      AS ENUM ('QUEUED','RUNNING','READY','FAILED','EXPIRED');

-- ---------------------------------------------------------------------
-- 2. Tenancy, identity and access
-- ---------------------------------------------------------------------
CREATE TABLE organizations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  slug                text        NOT NULL,
  industry            text,
  country_code        char(2),
  default_timezone    text        NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
  locale              text        NOT NULL DEFAULT 'en',
  logo_url            text,
  reference_prefix    text        NOT NULL DEFAULT 'INC',
  settings            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ai_enabled          boolean     NOT NULL DEFAULT true,
  ai_monthly_budget_usd numeric(10,2) NOT NULL DEFAULT 25.00,
  retention_years     smallint    NOT NULL DEFAULT 7 CHECK (retention_years >= 7),
  mfa_required        boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE UNIQUE INDEX organizations_slug_key ON organizations (lower(slug));

CREATE TABLE subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  tier                plan_tier            NOT NULL DEFAULT 'TRIAL',
  status              subscription_status  NOT NULL DEFAULT 'TRIALING',
  seat_limit          integer     NOT NULL DEFAULT 10,
  site_limit          integer     NOT NULL DEFAULT 1,
  storage_limit_gb    integer     NOT NULL DEFAULT 5,
  trial_ends_at       timestamptz,
  current_period_end  timestamptz,
  provider            text,                          -- 'stripe' | 'flutterwave' | 'manual'
  provider_customer_id text,
  provider_subscription_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text        NOT NULL,
  email_verified_at   timestamptz,
  password_hash       text,                          -- null for invite-pending / SSO users
  full_name           text        NOT NULL,
  phone_e164          text,
  job_title           text,
  avatar_url          text,
  locale              text        NOT NULL DEFAULT 'en',
  mfa_secret          text,
  mfa_enabled_at      timestamptz,
  last_login_at       timestamptz,
  failed_login_count  smallint    NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_phone_idx ON users (phone_e164) WHERE phone_e164 IS NOT NULL;

-- A user may belong to several organizations; exactly one role per organization.
CREATE TABLE memberships (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  role                org_role    NOT NULL DEFAULT 'EMPLOYEE',
  all_sites           boolean     NOT NULL DEFAULT false,
  is_active           boolean     NOT NULL DEFAULT true,
  notification_prefs  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  joined_at           timestamptz NOT NULL DEFAULT now(),
  deactivated_at      timestamptz,
  UNIQUE (organization_id, user_id)
);
CREATE INDEX memberships_org_role_idx ON memberships (organization_id, role) WHERE is_active;
CREATE INDEX memberships_user_idx     ON memberships (user_id);

CREATE TABLE sites (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  code                text        NOT NULL,
  timezone            text        NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
  country_code        char(2),
  address             text,
  latitude            numeric(9,6),
  longitude           numeric(9,6),
  anonymous_reporting_enabled boolean NOT NULL DEFAULT true,
  anonymous_token     text        UNIQUE,            -- public /r/{slug}/{token} route
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX sites_org_idx ON sites (organization_id) WHERE is_active;

CREATE TABLE departments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id             uuid REFERENCES sites(id) ON DELETE SET NULL,
  name                text        NOT NULL,
  code                text,
  manager_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX departments_org_site_idx ON departments (organization_id, site_id) WHERE is_active;

-- Site scoping for users who are not all_sites
CREATE TABLE membership_sites (
  membership_id       uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  site_id             uuid NOT NULL REFERENCES sites(id)       ON DELETE CASCADE,
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  PRIMARY KEY (membership_id, site_id)
);

CREATE TABLE invitations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email               text        NOT NULL,
  role                org_role    NOT NULL DEFAULT 'EMPLOYEE',
  all_sites           boolean     NOT NULL DEFAULT false,
  site_ids            uuid[]      NOT NULL DEFAULT '{}',
  token_hash          text        NOT NULL UNIQUE,
  invited_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at          timestamptz NOT NULL,
  accepted_at         timestamptz,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invitations_pending_key
  ON invitations (organization_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Auth.js session storage (DB strategy)
CREATE TABLE auth_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token       text        NOT NULL UNIQUE,
  active_org_id       uuid REFERENCES organizations(id) ON DELETE SET NULL,
  ip_address          inet,
  user_agent          text,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);

CREATE TABLE verification_tokens (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier          text        NOT NULL,          -- email
  token_hash          text        NOT NULL UNIQUE,
  purpose             text        NOT NULL,          -- 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'MAGIC_LINK'
  expires_at          timestamptz NOT NULL,
  consumed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3. Configuration
-- ---------------------------------------------------------------------
CREATE TABLE taxonomy_terms (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind                taxonomy_kind NOT NULL,
  key                 text        NOT NULL,
  label               text        NOT NULL,
  sort_order          smallint    NOT NULL DEFAULT 100,
  is_system           boolean     NOT NULL DEFAULT false,
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, kind, key)
);
CREATE INDEX taxonomy_terms_lookup_idx ON taxonomy_terms (organization_id, kind) WHERE is_active;

CREATE TABLE notification_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category            notification_category NOT NULL,
  is_enabled          boolean     NOT NULL DEFAULT true,
  channels            notification_channel[] NOT NULL DEFAULT '{IN_APP,EMAIL}',
  -- offsets in hours relative to the anchor event; negative = before due date
  offsets_hours       integer[]   NOT NULL DEFAULT '{}',
  min_severity        severity_level,
  recipient_roles     org_role[]  NOT NULL DEFAULT '{}',
  extra_recipient_user_ids uuid[] NOT NULL DEFAULT '{}',
  respect_quiet_hours boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, category)
);

-- Gapless human-readable references: INC-2026-0042
CREATE TABLE reference_sequences (
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prefix              text        NOT NULL,
  year                smallint    NOT NULL,
  last_value          integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, prefix, year)
);

CREATE OR REPLACE FUNCTION app.next_reference(p_org uuid, p_prefix text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_year smallint := EXTRACT(YEAR FROM now())::smallint;
  v_next integer;
BEGIN
  INSERT INTO reference_sequences (organization_id, prefix, year, last_value)
       VALUES (p_org, p_prefix, v_year, 1)
  ON CONFLICT (organization_id, prefix, year)
  DO UPDATE SET last_value = reference_sequences.last_value + 1
  RETURNING last_value INTO v_next;

  RETURN p_prefix || '-' || v_year::text || '-' || lpad(v_next::text, 4, '0');
END $$;

-- The scheduled jobs must enumerate tenants before they can scope to one,
-- which RLS correctly forbids: app.current_org() is NULL outside withTenant(),
-- so a direct read of `organizations` returns zero rows and every job would
-- silently do nothing.
--
-- SECURITY DEFINER gives the job runner exactly one narrow capability — the
-- list of active organization ids, and nothing else — instead of granting
-- BYPASSRLS, which would disable tenant isolation everywhere.
CREATE OR REPLACE FUNCTION app.active_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE AS $$
  SELECT id FROM organizations WHERE deleted_at IS NULL ORDER BY created_at
$$;

-- Authentication has a chicken-and-egg problem with RLS: resolving which
-- organization a user belongs to requires reading `memberships`, but that
-- table is RLS-protected and the tenant context does not exist yet. A plain
-- read during login returns zero rows and every sign-in fails with
-- ORG_CONTEXT_REQUIRED.
--
-- This returns only the caller-supplied user's own memberships — never
-- another user's, never any tenant data — so the exposure is one row set
-- keyed by a user id the session already proved.
CREATE OR REPLACE FUNCTION app.user_memberships(p_user_id uuid)
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  role            org_role,
  all_sites       boolean,
  site_ids        uuid[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE AS $$
  SELECT
    m.organization_id,
    o.name,
    m.role,
    m.all_sites,
    COALESCE(
      (SELECT array_agg(ms.site_id) FROM membership_sites ms WHERE ms.membership_id = m.id),
      '{}'::uuid[]
    )
  FROM memberships m
  JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = p_user_id
    AND m.is_active
    AND o.deleted_at IS NULL
  ORDER BY m.joined_at
$$;

-- The third and last of the pre-tenant-context lookups.
--
-- There is a recurring trap in this design: anything that must identify WHICH
-- tenant a request belongs to necessarily runs before app.current_org_id is
-- set, and so is blocked by the very RLS policies that protect it. It has bitten
-- three times — the job runner enumerating organizations, login resolving a
-- user's memberships, and now an anonymous report resolving its site token.
--
-- The rule: such a lookup NEVER reads a table directly. It goes through a
-- SECURITY DEFINER function that returns the minimum needed to establish the
-- context and nothing else. Here that is a site id and an org id, for a token
-- the caller already holds.
CREATE OR REPLACE FUNCTION app.resolve_site_token(p_token text)
RETURNS TABLE (site_id uuid, organization_id uuid, site_name text, org_name text, org_slug text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE AS $$
  SELECT s.id, s.organization_id, s.name, o.name, o.slug
  FROM sites s
  JOIN organizations o ON o.id = s.organization_id
  WHERE s.anonymous_token = p_token
    AND s.is_active
    AND s.anonymous_reporting_enabled
    AND o.deleted_at IS NULL
  LIMIT 1
$$;

COMMENT ON FUNCTION app.resolve_site_token(text) IS
  'Public anonymous-reporting support. Resolves a site token to its tenant before any tenant context exists. Returns identifiers only, never report data.';

COMMENT ON FUNCTION app.user_memberships(uuid) IS
  'Authentication support. Resolves one user''s own memberships before a tenant context exists. SECURITY DEFINER because memberships is RLS-protected and login is what establishes the context.';

COMMENT ON FUNCTION app.active_organization_ids() IS
  'Job-runner support. Returns only organization ids, never tenant data. SECURITY DEFINER so the scheduled jobs can iterate tenants without BYPASSRLS.';

COMMENT ON FUNCTION app.next_reference IS
  'Gapless per-org/per-prefix/per-year reference. The ON CONFLICT DO UPDATE takes a row lock, so concurrent callers serialise for microseconds.';

-- ---------------------------------------------------------------------
-- 4. Events (incidents, near misses, hazards, observations)
-- ---------------------------------------------------------------------
CREATE TABLE incidents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference           text        NOT NULL,
  report_type         report_type NOT NULL,
  status              report_status NOT NULL DEFAULT 'DRAFT',
  source              source_channel NOT NULL DEFAULT 'WEB',

  title               text,
  description         text        NOT NULL,
  immediate_action    text,

  site_id             uuid        NOT NULL REFERENCES sites(id)       ON DELETE RESTRICT,
  department_id       uuid        REFERENCES departments(id)          ON DELETE SET NULL,
  work_area           text,
  latitude            numeric(9,6),
  longitude           numeric(9,6),

  category_term_id    uuid        REFERENCES taxonomy_terms(id)       ON DELETE SET NULL,
  severity            severity_level,
  likelihood          likelihood_level,
  risk_score          smallint,                     -- maintained by trigger
  risk_band           risk_band,                    -- maintained by trigger

  occurred_at         timestamptz NOT NULL,
  reported_at         timestamptz NOT NULL DEFAULT now(),
  acknowledged_at     timestamptz,
  investigation_required boolean  NOT NULL DEFAULT false,
  closed_at           timestamptz,
  closure_statement   text,
  lessons_learned     text,

  reported_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  is_anonymous        boolean     NOT NULL DEFAULT false,
  anonymous_contact_encrypted bytea,               -- AES-256-GCM, HSE-visible only
  acknowledged_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_by_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,

  lost_time           boolean     NOT NULL DEFAULT false,
  reportable_to_authority boolean NOT NULL DEFAULT false,
  authority_reference text,
  estimated_cost      numeric(14,2),
  cost_currency       char(3),

  duplicate_of_id     uuid REFERENCES incidents(id) ON DELETE SET NULL,
  rejection_reason    text,

  idempotency_key     text,                         -- offline-queued submissions
  ai_summary          text,
  search_vector       tsvector,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT incidents_reference_unique UNIQUE (organization_id, reference),
  CONSTRAINT incidents_occurred_not_future CHECK (occurred_at <= now() + interval '1 hour'),
  CONSTRAINT incidents_anonymous_has_no_reporter
    CHECK (NOT is_anonymous OR reported_by_user_id IS NULL),
  CONSTRAINT incidents_closed_has_statement
    CHECK (status <> 'CLOSED' OR (closed_at IS NOT NULL AND closure_statement IS NOT NULL)),
  CONSTRAINT incidents_rejected_has_reason
    CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL),
  CONSTRAINT incidents_duplicate_has_target
    CHECK (status <> 'DUPLICATE' OR duplicate_of_id IS NOT NULL)
);

CREATE UNIQUE INDEX incidents_idempotency_key
  ON incidents (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX incidents_org_status_idx   ON incidents (organization_id, status, occurred_at DESC);
CREATE INDEX incidents_org_site_idx     ON incidents (organization_id, site_id, occurred_at DESC);
CREATE INDEX incidents_org_type_idx     ON incidents (organization_id, report_type, occurred_at DESC);
CREATE INDEX incidents_org_severity_idx ON incidents (organization_id, severity, occurred_at DESC);
CREATE INDEX incidents_reporter_idx     ON incidents (reported_by_user_id, created_at DESC);
CREATE INDEX incidents_open_idx         ON incidents (organization_id, reported_at)
  WHERE status IN ('SUBMITTED','ACKNOWLEDGED','INVESTIGATING','ACTIONS_PENDING','PENDING_CLOSURE');
CREATE INDEX incidents_triage_idx       ON incidents (organization_id, severity DESC, reported_at)
  WHERE status = 'SUBMITTED';
CREATE INDEX incidents_search_idx       ON incidents USING gin (search_vector);
CREATE INDEX incidents_keyset_idx       ON incidents (organization_id, created_at DESC, id DESC);

-- People connected to an event (named users or free text for contractors/visitors)
CREATE TABLE incident_persons (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id         uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  full_name           text,
  contact             text,
  employer            text,
  involvement         person_involvement NOT NULL,
  statement           text,
  -- injury detail (only meaningful when involvement = 'INJURED')
  injury_type_term_id uuid REFERENCES taxonomy_terms(id) ON DELETE SET NULL,
  body_part_term_id   uuid REFERENCES taxonomy_terms(id) ON DELETE SET NULL,
  treatment           treatment_level,
  days_lost           smallint CHECK (days_lost IS NULL OR days_lost >= 0),
  is_sensitive        boolean NOT NULL DEFAULT true,  -- health data: HSE-only visibility
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_persons_identified CHECK (user_id IS NOT NULL OR full_name IS NOT NULL)
);
CREATE INDEX incident_persons_incident_idx ON incident_persons (incident_id);

-- ---------------------------------------------------------------------
-- 5. Investigations, findings and root causes
-- ---------------------------------------------------------------------
CREATE TABLE investigations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id         uuid NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
  status              investigation_status NOT NULL DEFAULT 'ASSIGNED',
  lead_investigator_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  team_user_ids       uuid[]      NOT NULL DEFAULT '{}',
  assigned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at         timestamptz NOT NULL DEFAULT now(),
  due_at              timestamptz NOT NULL,
  started_at          timestamptz,
  submitted_at        timestamptz,
  approved_at         timestamptz,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  returned_at         timestamptz,
  return_comments     text,
  methodology         text        NOT NULL DEFAULT 'FIVE_WHYS',
  summary             text,
  ai_summary          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investigations_returned_has_comments
    CHECK (status <> 'RETURNED' OR return_comments IS NOT NULL)
);
CREATE INDEX investigations_org_status_idx ON investigations (organization_id, status, due_at);
CREATE INDEX investigations_lead_idx       ON investigations (lead_investigator_id, status);
CREATE INDEX investigations_overdue_idx    ON investigations (organization_id, due_at)
  WHERE status IN ('ASSIGNED','IN_PROGRESS','RETURNED');

CREATE TABLE investigation_timeline_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  investigation_id    uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  occurred_at         timestamptz NOT NULL,
  description         text        NOT NULL,
  sort_order          smallint    NOT NULL DEFAULT 0,
  created_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX investigation_timeline_idx ON investigation_timeline_entries (investigation_id, occurred_at);

CREATE TABLE investigation_interviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  investigation_id    uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  interviewee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  interviewee_name    text,
  interviewed_at      timestamptz NOT NULL,
  notes               text        NOT NULL,
  is_sensitive        boolean     NOT NULL DEFAULT false,
  created_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX investigation_interviews_idx ON investigation_interviews (investigation_id);

CREATE TABLE findings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  investigation_id    uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  finding_type        finding_type NOT NULL,
  statement           text        NOT NULL,
  evidence_note       text,
  sort_order          smallint    NOT NULL DEFAULT 0,
  created_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX findings_investigation_idx ON findings (investigation_id, finding_type);

CREATE TABLE root_causes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  investigation_id    uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  problem_statement   text        NOT NULL,          -- the "why chain" starting point
  statement           text        NOT NULL,          -- the identified root cause
  category            root_cause_category NOT NULL,
  is_systemic         boolean     NOT NULL DEFAULT true,
  created_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX root_causes_investigation_idx ON root_causes (investigation_id);
CREATE INDEX root_causes_category_idx      ON root_causes (organization_id, category, created_at DESC);

CREATE TABLE root_cause_whys (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  root_cause_id       uuid NOT NULL REFERENCES root_causes(id) ON DELETE CASCADE,
  step                smallint    NOT NULL CHECK (step BETWEEN 1 AND 7),
  question            text        NOT NULL,
  answer              text        NOT NULL,
  ai_suggested        boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (root_cause_id, step)
);

-- ---------------------------------------------------------------------
-- 6. CAPA
-- ---------------------------------------------------------------------
CREATE TABLE actions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference           text        NOT NULL,
  title               text        NOT NULL,
  description         text,
  action_type         action_type NOT NULL,
  status              action_status NOT NULL DEFAULT 'OPEN',
  priority            priority_level NOT NULL DEFAULT 'MEDIUM',
  hierarchy_level     hierarchy_of_control NOT NULL,

  incident_id         uuid REFERENCES incidents(id)   ON DELETE CASCADE,
  investigation_id    uuid REFERENCES investigations(id) ON DELETE SET NULL,
  finding_id          uuid REFERENCES findings(id)    ON DELETE SET NULL,
  root_cause_id       uuid REFERENCES root_causes(id) ON DELETE SET NULL,
  parent_action_id    uuid REFERENCES actions(id)     ON DELETE SET NULL,  -- follow-up chain

  site_id             uuid REFERENCES sites(id)       ON DELETE SET NULL,
  department_id       uuid REFERENCES departments(id) ON DELETE SET NULL,

  owner_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  verifier_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,

  original_due_date   date        NOT NULL,
  due_date            date        NOT NULL,
  started_at          timestamptz,
  submitted_at        timestamptz,
  verified_at         timestamptz,
  closed_at           timestamptz,
  cancelled_reason    text,

  effectiveness       effectiveness_rating,
  verification_comments text,
  evidence_required   boolean     NOT NULL DEFAULT true,
  search_vector       tsvector,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT actions_reference_unique UNIQUE (organization_id, reference),
  CONSTRAINT actions_owner_is_not_verifier CHECK (verifier_user_id IS NULL OR verifier_user_id <> owner_user_id),
  CONSTRAINT actions_verified_has_rating
    CHECK (status <> 'VERIFIED_CLOSED' OR (effectiveness IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT actions_cancelled_has_reason
    CHECK (status <> 'CANCELLED' OR cancelled_reason IS NOT NULL)
);

CREATE INDEX actions_org_status_idx   ON actions (organization_id, status, due_date);
CREATE INDEX actions_owner_idx        ON actions (owner_user_id, status, due_date);
CREATE INDEX actions_verifier_idx     ON actions (verifier_user_id, status) WHERE status = 'PENDING_VERIFICATION';
CREATE INDEX actions_incident_idx     ON actions (incident_id);
CREATE INDEX actions_overdue_idx      ON actions (organization_id, due_date)
  WHERE status IN ('OPEN','IN_PROGRESS','REJECTED');
CREATE INDEX actions_site_idx         ON actions (organization_id, site_id, due_date);
CREATE INDEX actions_search_idx       ON actions USING gin (search_vector);
CREATE INDEX actions_keyset_idx       ON actions (organization_id, created_at DESC, id DESC);

CREATE TABLE action_updates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action_id           uuid NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  note                text        NOT NULL,
  progress_percent    smallint CHECK (progress_percent BETWEEN 0 AND 100),
  status_from         action_status,
  status_to           action_status,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX action_updates_action_idx ON action_updates (action_id, created_at DESC);

CREATE TABLE action_extensions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action_id           uuid NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  previous_due_date   date        NOT NULL,
  requested_due_date  date        NOT NULL,
  reason              text        NOT NULL,
  decided_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at          timestamptz,
  approved            boolean,
  decision_comments   text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX action_extensions_action_idx ON action_extensions (action_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 7. Attachments and comments (polymorphic, org-scoped)
-- ---------------------------------------------------------------------
CREATE TABLE attachments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity              entity_type NOT NULL,
  entity_id           uuid        NOT NULL,
  storage_key         text        NOT NULL UNIQUE,
  file_name           text        NOT NULL,
  mime_type           text        NOT NULL,
  size_bytes          bigint      NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256     text,
  thumbnail_key       text,
  caption             text,
  is_evidence         boolean     NOT NULL DEFAULT true,
  is_sensitive        boolean     NOT NULL DEFAULT false,
  upload_status       attachment_status NOT NULL DEFAULT 'PENDING',
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  captured_at         timestamptz,
  latitude            numeric(9,6),
  longitude           numeric(9,6),
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE INDEX attachments_entity_idx  ON attachments (organization_id, entity, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX attachments_pending_idx ON attachments (created_at) WHERE upload_status = 'PENDING';

CREATE TABLE comments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity              entity_type NOT NULL,
  entity_id           uuid        NOT NULL,
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  body                text        NOT NULL,
  is_internal         boolean     NOT NULL DEFAULT false,   -- hidden from the reporter
  mentions            uuid[]      NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE INDEX comments_entity_idx ON comments (organization_id, entity, entity_id, created_at) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- 8. Notifications
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipient_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category            notification_category NOT NULL,
  title               text        NOT NULL,
  body                text        NOT NULL,
  entity              entity_type,
  entity_id           uuid,
  deep_link           text,
  severity            severity_level,
  read_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_recipient_idx ON notifications (recipient_user_id, created_at DESC);
CREATE INDEX notifications_unread_idx    ON notifications (recipient_user_id) WHERE read_at IS NULL;

CREATE TABLE notification_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  notification_id     uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel             notification_channel NOT NULL,
  status              delivery_status NOT NULL DEFAULT 'QUEUED',
  provider            text,
  provider_message_id text,
  attempts            smallint    NOT NULL DEFAULT 0,
  error               text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_deliveries_notif_idx ON notification_deliveries (notification_id);
CREATE INDEX notification_deliveries_failed_idx ON notification_deliveries (organization_id, created_at DESC)
  WHERE status = 'FAILED';

-- Idempotency guard for scheduled reminders: one row per (entity, rule, window)
CREATE TABLE notification_log (
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity              entity_type NOT NULL,
  entity_id           uuid        NOT NULL,
  rule_key            text        NOT NULL,       -- e.g. 'ACTION_DUE:-72h'
  recipient_user_id   uuid        NOT NULL,
  scheduled_for       date        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, entity_id, rule_key, recipient_user_id, scheduled_for)
);

-- Rate limiting, in Postgres rather than Redis: it works identically on a
-- serverless platform where in-process counters are useless (every request may
-- hit a fresh instance), and it adds no infrastructure. Applied only to the
-- routes that need it — auth, anonymous reporting, AI — not to every request.
CREATE TABLE rate_limits (
  bucket              text        NOT NULL,   -- e.g. 'login:ip:203.0.113.4'
  window_start        timestamptz NOT NULL,
  hits                integer     NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX rate_limits_sweep_idx ON rate_limits (window_start);

COMMENT ON TABLE rate_limits IS
  'Fixed-window counters. Not tenant-scoped: the subject is usually an IP or an email that has not yet been resolved to a tenant, so RLS deliberately does not apply.';

-- ---------------------------------------------------------------------
-- 9. Audit trail (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE audit_events (
  id                  bigserial PRIMARY KEY,
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_label         text,                        -- preserved even if the user is removed
  action              audit_action NOT NULL,
  entity              entity_type  NOT NULL,
  entity_id           uuid,
  entity_reference    text,                        -- e.g. INC-2026-0042, for readable logs
  changes             jsonb,                       -- {field: {from, to}}
  metadata            jsonb        NOT NULL DEFAULT '{}'::jsonb,
  ip_address          inet,
  user_agent          text,
  request_id          text,
  created_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_time_idx ON audit_events (organization_id, created_at DESC);
CREATE INDEX audit_events_entity_idx   ON audit_events (entity, entity_id, created_at DESC);
CREATE INDEX audit_events_actor_idx    ON audit_events (actor_user_id, created_at DESC);

COMMENT ON TABLE audit_events IS
  'Append-only and always org-scoped. The application role is granted INSERT and SELECT only. Pre-authentication security events (failed logins, unknown-email resets) have no org context and are written to the application log and Sentry, never here.';

-- ---------------------------------------------------------------------
-- 10. AI, WhatsApp, exports
-- ---------------------------------------------------------------------
CREATE TABLE ai_interactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  feature             ai_feature  NOT NULL,
  entity              entity_type,
  entity_id           uuid,
  model               text        NOT NULL,
  prompt_version      text        NOT NULL,
  prompt_hash         text,
  input_tokens        integer,
  output_tokens       integer,
  cost_usd            numeric(10,6),
  latency_ms          integer,
  outcome             ai_outcome  NOT NULL DEFAULT 'SHOWN',
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_interactions_org_idx     ON ai_interactions (organization_id, created_at DESC);
CREATE INDEX ai_interactions_feature_idx ON ai_interactions (organization_id, feature, outcome);

CREATE TABLE whatsapp_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid REFERENCES organizations(id) ON DELETE CASCADE,
  phone_e164          text        NOT NULL,
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  state               text        NOT NULL DEFAULT 'START',
  draft               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_message_at     timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX whatsapp_sessions_phone_idx ON whatsapp_sessions (phone_e164);

CREATE TABLE exports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  scope               text        NOT NULL,        -- 'incidents' | 'actions' | 'incident:{id}' | 'audit'
  format              export_format NOT NULL,
  filters             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status              export_status NOT NULL DEFAULT 'QUEUED',
  row_count           integer,
  storage_key         text,
  error               text,
  expires_at          timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz
);
CREATE INDEX exports_org_idx ON exports (organization_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 11. Triggers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','subscriptions','users','sites','departments','notification_rules',
    'incidents','investigations','findings','root_causes','actions','comments'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_touch BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t, t);
  END LOOP;
END $$;

-- Risk score/band derived from severity × likelihood
CREATE OR REPLACE FUNCTION app.incident_risk() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE s smallint; l smallint;
BEGIN
  IF NEW.severity IS NULL OR NEW.likelihood IS NULL THEN
    NEW.risk_score := NULL; NEW.risk_band := NULL; RETURN NEW;
  END IF;
  s := array_position(ARRAY['NEGLIGIBLE','MINOR','MODERATE','MAJOR','CATASTROPHIC'], NEW.severity::text);
  l := array_position(ARRAY['RARE','UNLIKELY','POSSIBLE','LIKELY','ALMOST_CERTAIN'], NEW.likelihood::text);
  NEW.risk_score := s * l;
  NEW.risk_band := CASE
    WHEN NEW.risk_score >= 15 THEN 'CRITICAL'
    WHEN NEW.risk_score >= 10 THEN 'HIGH'
    WHEN NEW.risk_score >= 5  THEN 'MEDIUM'
    ELSE 'LOW' END::risk_band;
  RETURN NEW;
END $$;

CREATE TRIGGER incidents_risk BEFORE INSERT OR UPDATE OF severity, likelihood ON incidents
  FOR EACH ROW EXECUTE FUNCTION app.incident_risk();

-- Full-text search vectors
CREATE OR REPLACE FUNCTION app.incident_search() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
      setweight(to_tsvector('simple',  coalesce(NEW.reference,'')), 'A')
   || setweight(to_tsvector('english', coalesce(NEW.title,'')),      'A')
   || setweight(to_tsvector('english', coalesce(NEW.description,'')),'B')
   || setweight(to_tsvector('english', coalesce(NEW.work_area,'')),  'C')
   || setweight(to_tsvector('english', coalesce(NEW.immediate_action,'')), 'C');
  RETURN NEW;
END $$;

CREATE TRIGGER incidents_search BEFORE INSERT OR UPDATE OF reference, title, description, work_area, immediate_action
  ON incidents FOR EACH ROW EXECUTE FUNCTION app.incident_search();

CREATE OR REPLACE FUNCTION app.action_search() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
      setweight(to_tsvector('simple',  coalesce(NEW.reference,'')), 'A')
   || setweight(to_tsvector('english', coalesce(NEW.title,'')),      'A')
   || setweight(to_tsvector('english', coalesce(NEW.description,'')),'B');
  RETURN NEW;
END $$;

CREATE TRIGGER actions_search BEFORE INSERT OR UPDATE OF reference, title, description
  ON actions FOR EACH ROW EXECUTE FUNCTION app.action_search();

-- ---------------------------------------------------------------------
-- 12. Analytics: materialized views for trend tiles
--     (current-state tiles query the base tables live)
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_incident_daily AS
SELECT
  i.organization_id,
  i.site_id,
  i.report_type,
  i.severity,
  date_trunc('day', i.occurred_at)::date            AS day,
  count(*)                                          AS event_count,
  count(*) FILTER (WHERE i.lost_time)               AS lost_time_count,
  count(*) FILTER (WHERE i.status = 'CLOSED')       AS closed_count,
  avg(EXTRACT(EPOCH FROM (i.reported_at - i.occurred_at))/3600.0)   AS avg_hours_to_report,
  avg(EXTRACT(EPOCH FROM (i.closed_at   - i.reported_at))/86400.0)  AS avg_days_to_close
FROM incidents i
WHERE i.status NOT IN ('DRAFT','REJECTED','DUPLICATE')
GROUP BY 1,2,3,4,5;

CREATE UNIQUE INDEX mv_incident_daily_key
  ON mv_incident_daily (organization_id, site_id, report_type, severity, day);

CREATE MATERIALIZED VIEW mv_action_daily AS
SELECT
  a.organization_id,
  a.site_id,
  a.action_type,
  a.hierarchy_level,
  date_trunc('day', a.created_at)::date              AS day,
  count(*)                                           AS created_count,
  count(*) FILTER (WHERE a.status = 'VERIFIED_CLOSED')                       AS closed_count,
  count(*) FILTER (WHERE a.status = 'VERIFIED_CLOSED'
                     AND a.verified_at::date <= a.due_date)                  AS closed_on_time_count,
  avg(a.due_date - a.original_due_date)                                      AS avg_extension_days
FROM actions a
GROUP BY 1,2,3,4,5;

CREATE UNIQUE INDEX mv_action_daily_key
  ON mv_action_daily (organization_id, site_id, action_type, hierarchy_level, day);

-- ---------------------------------------------------------------------
-- 13. Row-Level Security
--     The application connects as a role WITHOUT BYPASSRLS.
--     app.current_org() returns NULL when unset → every policy denies.
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','subscriptions','memberships','membership_sites','sites','departments',
    'invitations','taxonomy_terms','notification_rules','reference_sequences',
    'incidents','incident_persons','investigations','investigation_timeline_entries',
    'investigation_interviews','findings','root_causes','root_cause_whys',
    'actions','action_updates','action_extensions','attachments','comments',
    'notifications','notification_deliveries','notification_log',
    'audit_events','ai_interactions','exports'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF t = 'organizations' THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (id = app.current_org())
           WITH CHECK (id = app.current_org())', t);
    ELSE
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (organization_id = app.current_org())
           WITH CHECK (organization_id = app.current_org())', t);
    END IF;
  END LOOP;
END $$;

-- users / auth_sessions / verification_tokens / whatsapp_sessions are cross-tenant by nature
-- (a person may belong to two customers). They are protected at the application layer only,
-- and no tenant-scoped query ever selects from them without joining memberships.

-- ---------------------------------------------------------------------
-- 14. Application role and grants
--     Run once per environment as a superuser, with the password injected.
-- ---------------------------------------------------------------------
-- CREATE ROLE safesphere_app LOGIN PASSWORD :'app_password' NOBYPASSRLS;
-- GRANT USAGE ON SCHEMA public, app TO safesphere_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO safesphere_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO safesphere_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO safesphere_app;
-- -- audit trail is append-only for the application:
-- REVOKE UPDATE, DELETE ON audit_events FROM safesphere_app;

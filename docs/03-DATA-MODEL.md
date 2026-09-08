# 03 — Data Model

Canonical DDL: [`db/schema.sql`](../db/schema.sql) — verified against PostgreSQL 16.
Demo fixture: [`db/seed.sql`](../db/seed.sql).

```bash
psql "$DATABASE_URL" -f db/schema.sql -f db/seed.sql
```

---

## 1. Entity map

```
organizations ─┬─ subscriptions (1:1)
               ├─ memberships ──── users (M:N; one role per org)
               │     └─ membership_sites ── sites
               ├─ sites ─── departments
               ├─ taxonomy_terms          (categories, injury types, body parts…)
               ├─ notification_rules
               ├─ reference_sequences     (gapless INC-2026-0042)
               │
               ├─ incidents ─┬─ incident_persons     (involved / injured / witness)
               │             ├─ attachments  (polymorphic)
               │             ├─ comments     (polymorphic)
               │             └─ investigations (1:0..1)
               │                  ├─ investigation_timeline_entries
               │                  ├─ investigation_interviews
               │                  ├─ findings
               │                  └─ root_causes ── root_cause_whys (1..7 steps)
               │
               ├─ actions ─┬─ action_updates
               │           ├─ action_extensions
               │           └─ attachments (evidence)
               │     ↑ actions link to incident, investigation, finding or root_cause,
               │       and to a parent_action (follow-up when verification fails)
               │
               ├─ notifications ── notification_deliveries
               ├─ notification_log        (reminder idempotency guard)
               ├─ audit_events            (append-only)
               ├─ ai_interactions
               └─ exports

cross-tenant by nature (a person may work for two customers):
  users · auth_sessions · verification_tokens · whatsapp_sessions
```

## 2. Design notes

**One `incidents` table for four report types.** `report_type ∈ {INCIDENT, NEAR_MISS, HAZARD,
OBSERVATION}`. They share the entire lifecycle; splitting them would quadruple the API, the forms
and the dashboard queries for no gain. Rationale and the revisit trigger:
[00 §D5](00-SOURCE-ANALYSIS.md#d5-one-incidents-table-for-incident--near-miss--hazard--observation).

**Risk is derived, not entered.** `risk_score = severity_ordinal × likelihood_ordinal` and
`risk_band` are maintained by the `incidents_risk` trigger, so no application path can produce an
inconsistent band. Bands: 1–4 Low, 5–9 Medium, 10–14 High, 15–25 Critical.

**References are gapless.** `app.next_reference(org, prefix)` uses `INSERT … ON CONFLICT DO UPDATE
… RETURNING`, which takes a row lock on `reference_sequences` for microseconds. A sequence would be
simpler but leaves gaps on rollback, and auditors ask about gaps.

**Search is a stored `tsvector`** maintained by trigger, weighted A=reference+title,
B=description, C=work area + immediate action, with a GIN index. Verified working on the seed data.

**Injury data is flagged sensitive.** `incident_persons.is_sensitive` defaults true; the API strips
those columns for any role without `incident.view_sensitive`, and reads are logged as
`VIEW_SENSITIVE` audit events.

**Nothing of record is deleted.** `deleted_at` exists only on `attachments` and `comments`.
Incidents, investigations, actions and audit events transition status; they never disappear.

**Attachments and comments are polymorphic** on `(entity, entity_id)`. Postgres cannot enforce a
foreign key across a polymorphic pair, so the service layer validates the target exists and the
caller may access it before insert. The trade is deliberate: one upload pipeline instead of six.

## 3. Multi-tenancy in the schema

Every tenant table carries `organization_id NOT NULL` and has RLS `ENABLE` + `FORCE` with

```sql
USING (organization_id = app.current_org()) WITH CHECK (organization_id = app.current_org())
```

`app.current_org()` returns `NULL` when `app.current_org_id` is unset, so an unscoped query
returns zero rows rather than everything — **fail closed**.

Verified against PostgreSQL 16 with a `NOBYPASSRLS` application role:

| Test | Expected | Result |
|---|---|---|
| Query with no tenant context | 0 rows | ✅ 0 |
| Query as tenant A | tenant A's 131 incidents | ✅ 131 |
| Query as tenant B | tenant B's 1 incident, 0 of tenant A's | ✅ 1 / 0 |
| INSERT into tenant A while scoped to tenant B | rejected | ✅ `new row violates row-level security policy` |
| `DELETE FROM audit_events` as the app role | rejected | ✅ `permission denied for table audit_events` |

These five assertions are the tenancy suite in
[02-BLUEPRINT §4](02-TECHNICAL-BLUEPRINT.md#4-multi-tenancy) and are a CI merge gate.

## 4. State machines

### 4.1 Incident / report

```
        ┌──────── REJECTED (reason required)
        │
DRAFT ─▶ SUBMITTED ─▶ ACKNOWLEDGED ─┬─▶ INVESTIGATING ─▶ ACTIONS_PENDING ─▶ PENDING_CLOSURE ─▶ CLOSED
        │                           │                          ▲
        └──────── DUPLICATE         └──────────────────────────┘
                (link required)       (no investigation required)
```

| From | To | Who | Guard |
|---|---|---|---|
| DRAFT | SUBMITTED | author | required fields present |
| SUBMITTED | ACKNOWLEDGED | HSE | — |
| SUBMITTED | REJECTED | HSE | `rejection_reason` required |
| SUBMITTED | DUPLICATE | HSE | `duplicate_of_id` required |
| ACKNOWLEDGED | INVESTIGATING | HSE | investigation created with a lead + due date |
| ACKNOWLEDGED | ACTIONS_PENDING | HSE | `investigation_required = false`; forced true when severity ≥ MAJOR or `lost_time` |
| INVESTIGATING | ACTIONS_PENDING | HSE | investigation APPROVED, ≥1 root cause, ≥1 action |
| ACTIONS_PENDING | PENDING_CLOSURE | system | all linked actions VERIFIED_CLOSED or CANCELLED |
| PENDING_CLOSURE | CLOSED | HSE | `closure_statement` required |
| CLOSED | — | — | terminal; lessons-learned notes may still be appended |

DB-enforced: `incidents_closed_has_statement`, `incidents_rejected_has_reason`,
`incidents_duplicate_has_target`, `incidents_anonymous_has_no_reporter`,
`incidents_occurred_not_future`.

### 4.2 Investigation

```
ASSIGNED ─▶ IN_PROGRESS ─▶ SUBMITTED ─┬─▶ APPROVED
                ▲                     │
                └──── RETURNED ◀──────┘   (return_comments required)
```

Approval guard: ≥1 root cause with a category, ≥1 finding, ≥1 action.
DB-enforced: `investigations_returned_has_comments`.

### 4.3 Action (CAPA)

```
OPEN ─▶ IN_PROGRESS ─▶ PENDING_VERIFICATION ─┬─▶ VERIFIED_CLOSED
   │         ▲                               │
   │         └──────── REJECTED ◀────────────┘   (returns to the owner)
   └──▶ CANCELLED (reason required)

overdue = due_date < today AND status ∈ {OPEN, IN_PROGRESS, REJECTED}   ← derived, never stored
```

| Guard | Enforcement |
|---|---|
| Verifier ≠ owner | DB check `actions_owner_is_not_verifier` **and** service policy |
| Evidence required when source severity ≥ MODERATE | service |
| VERIFIED_CLOSED needs `effectiveness` + `verified_at` | DB check `actions_verified_has_rating` |
| `effectiveness = NOT_EFFECTIVE` | service auto-creates a follow-up via `parent_action_id` |
| Due-date change | only through an approved `action_extensions` row; `original_due_date` is immutable |

`overdue` is derived, not a status — a stored one would need a nightly sweep and would drift.

## 5. Indexing strategy

| Query shape | Index |
|---|---|
| Keyset pagination of any list | `(organization_id, created_at DESC, id DESC)` |
| Triage queue | partial on `status='SUBMITTED'`, `(org, severity DESC, reported_at)` |
| Open events | partial on the five open statuses |
| Overdue actions | partial on `status IN (OPEN, IN_PROGRESS, REJECTED)`, `(org, due_date)` |
| My actions | `(owner_user_id, status, due_date)` |
| Awaiting my verification | partial on `status='PENDING_VERIFICATION'` |
| Full-text | GIN on `search_vector` (incidents, actions) |
| Site/type/severity filters | composite `(org, <col>, occurred_at DESC)` |

Partial indexes matter here: open and overdue rows are a few percent of the table, and these are
the queries every dashboard load runs.

## 6. Analytics

Two materialized views refreshed every 30 minutes with `REFRESH … CONCURRENTLY` (each has a unique
index, which `CONCURRENTLY` requires):

- `mv_incident_daily` — per org/site/type/severity/day: counts, lost-time, closed, avg hours to
  report, avg days to close.
- `mv_action_daily` — per org/site/type/hierarchy/day: created, closed, closed-on-time, avg extension days.

Trend tiles read the views. **Current-state tiles (open, overdue, awaiting verification) always read
the base tables live** — an operational number that is 29 minutes stale is worse than no number.

Verified on the seed data: overdue 29 · leading:lagging 4.7:1 · on-time closure 67.4 % ·
median 21 h to report, 12.6 d to close.

## 7. Retention and deletion

| Data | Retention |
|---|---|
| Incidents, investigations, actions, audit events | Org's `retention_years` (default 7, floor 7) |
| Attachments | With their parent record |
| Notifications | 18 months |
| `ai_interactions` | 24 months (cost analysis + prompt-regression review) |
| `notification_log` | 90 days (it only guards reminder idempotency) |
| Exports | 7 days, then the object and row are purged |
| Sessions, verification tokens | On expiry |
| Tenant deletion | 30-day soft delete → irreversible purge → deletion certificate emailed to the Org Admin |

## 8. Migration policy

Prisma Migrate, expand/contract only. Every migration must be safe against the previous
application version running concurrently:

1. Add nullable column / new table → deploy
2. Backfill in a job → deploy code that writes both
3. Switch reads → deploy
4. Drop the old column in a **later** release

Forbidden in a single migration: renaming a column in use, adding `NOT NULL` without a default on a
populated table, dropping anything the running version still reads. Every migration is tested by
restoring the latest production backup into staging and applying it there first.

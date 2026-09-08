# 02 — Technical Blueprint

**Target:** a single engineer or a team of three can start Sprint 1 from this document.

---

## 1. Architecture at a glance

```
                         ┌──────────────────────────────┐
   Browser / PWA ───────▶│  Caddy (TLS, HTTP/3, gzip)   │
   WhatsApp Cloud API ──▶└──────────────┬───────────────┘
                                        │
                        ┌───────────────▼───────────────────────────┐
                        │  Next.js 15 app (Node 22, standalone)     │
                        │                                           │
                        │  app/(marketing)   public pages           │
                        │  app/(auth)        sign-in / invite       │
                        │  app/(app)         authenticated UI (RSC) │
                        │  app/(public)      anonymous report form  │
                        │  app/api/v1/*      REST route handlers    │
                        │  app/api/webhooks/* whatsapp, payments    │
                        │                                           │
                        │  src/server/  ← all business logic        │
                        │    modules/{incidents,investigations,...} │
                        │    db/ prisma + withTenant()              │
                        │    jobs/ pg-boss workers (same image)     │
                        │    services/{mail,whatsapp,storage,ai}    │
                        └───────┬───────────────┬───────────────────┘
                                │               │
                   ┌────────────▼──┐      ┌─────▼──────────────┐
                   │ PostgreSQL 16 │      │ Cloudflare R2      │
                   │  + RLS        │      │ (evidence, exports)│
                   │  + pg-boss    │      └────────────────────┘
                   │  + tsvector   │
                   └───────────────┘
                                │
        external: Anthropic API · Resend · WhatsApp Cloud API · Sentry
```

Two processes from one image: `web` (Next.js server) and `worker` (pg-boss consumer + cron).
Scaling to Sprint 5 is "run more web containers"; nothing in the design prevents it.

## 2. Stack decisions

| Concern | Choice | Version | Why not the alternative |
|---|---|---|---|
| Framework | Next.js App Router | 15.x | One language, RSC removes most client fetching, mature PWA story |
| Language | TypeScript strict | 5.6+ | `strict: true`, `noUncheckedIndexedAccess: true`, no `any` in `src/server` |
| UI | Tailwind + shadcn/ui + Radix | latest | Owned components, no design-system dependency, accessible primitives |
| Forms | react-hook-form + Zod | latest | Same Zod schema validates client and server — one source of truth |
| ORM | Prisma | 6.x | Migrations, typed client; raw SQL where the query planner matters |
| DB | PostgreSQL | 16 | RLS, JSONB, tsvector, materialized views, and pg-boss all in one engine |
| Jobs | pg-boss | 10.x | Durable queue + cron in Postgres; see [00 D3](00-SOURCE-ANALYSIS.md#d3-pg-boss-for-jobs-not-redisceleryinngest) |
| Auth | Auth.js v5 | 5.x | Credentials + magic link + TOTP, session in DB, org context in JWT claims |
| Files | Cloudflare R2 via `@aws-sdk/client-s3` | — | S3 API, zero egress fees, presigned direct upload |
| Email | Resend + React Email | — | Templates as components, good deliverability, cheap |
| AI | `@anthropic-ai/sdk` | latest | Behind `src/server/services/ai` — provider swappable |
| Charts | Recharts | 2.x | Adequate for the 12 dashboard tiles; no license cost |
| Tables | TanStack Table | 8.x | Server-driven pagination/sorting/filtering |
| Tests | Vitest + Playwright | — | Unit/integration on the server modules; E2E on the 5 critical journeys |
| Lint | ESLint + Prettier + `eslint-plugin-security` | — | Enforced in CI |
| Errors | Sentry | — | Source-mapped, org id and request id tagged |
| Analytics | PostHog (self-hosted or cloud) | — | Product events from [01-PRD §18](01-PRD-MVP.md#18-instrumentation--the-event-taxonomy) |

## 3. Repository layout

```
safesphere/
├─ app/
│  ├─ (marketing)/                 # landing, pricing — public
│  ├─ (auth)/sign-in|sign-up|invite/[token]|reset/
│  ├─ (public)/r/[orgSlug]/[siteToken]/   # anonymous report form
│  ├─ (app)/
│  │  ├─ layout.tsx                # org context provider, nav, role gating
│  │  ├─ dashboard/                # E7 tiles
│  │  ├─ reports/                  # list, [id], new, triage queue
│  │  ├─ investigations/[id]/      # investigation workspace + 5 Whys
│  │  ├─ actions/                  # list, my-actions, [id]
│  │  ├─ analytics/                # trends, exec view
│  │  ├─ admin/                    # users, sites, departments, taxonomies,
│  │  │                            # notification rules, billing, audit log
│  │  └─ settings/                 # profile, notification prefs, MFA
│  ├─ api/
│  │  ├─ v1/…                      # REST — see 04-API-SPEC.md
│  │  ├─ webhooks/whatsapp/route.ts
│  │  ├─ webhooks/payments/route.ts
│  │  └─ health/route.ts
│  ├─ manifest.ts  sw.ts           # PWA
│  └─ globals.css
├─ src/
│  ├─ server/
│  │  ├─ db/
│  │  │  ├─ client.ts              # PrismaClient singleton
│  │  │  ├─ tenant.ts              # withTenant() — RLS session wrapper
│  │  │  └─ raw/                   # hand-written analytics SQL
│  │  ├─ auth/                     # authOptions, session, permission guards
│  │  ├─ modules/
│  │  │  ├─ organizations/  {service.ts, schema.ts, policy.ts, __tests__}
│  │  │  ├─ users/          …
│  │  │  ├─ incidents/      …
│  │  │  ├─ investigations/ …
│  │  │  ├─ actions/        …
│  │  │  ├─ notifications/  …
│  │  │  ├─ analytics/      …
│  │  │  ├─ attachments/    …
│  │  │  ├─ audit/          …
│  │  │  └─ billing/        …
│  │  ├─ services/{mail,whatsapp,storage,ai,pdf,analytics}/
│  │  ├─ jobs/
│  │  │  ├─ index.ts               # pg-boss bootstrap + schedule registry
│  │  │  └─ handlers/{reminders,escalations,digests,notify,exports,refresh-mvs}.ts
│  │  └─ lib/{errors,pagination,idempotency,ratelimit,refnum,logger}.ts
│  ├─ components/{ui,forms,charts,layout}/
│  ├─ hooks/  ├─ lib/  └─ i18n/{en,sw}/
├─ prisma/{schema.prisma, migrations/, seed.ts}
├─ db/{schema.sql, seed.sql}       # canonical DDL — Prisma mirrors this
├─ api/openapi.yaml
├─ tests/{e2e/, fixtures/}
├─ docker/{Dockerfile, compose.yml, compose.prod.yml, Caddyfile}
├─ .github/workflows/{ci.yml, deploy.yml}
└─ docs/
```

**Rule:** route handlers and server components contain no business logic. They parse input with
Zod, call a module service, and shape the response. All logic, all authorization and all audit
writes happen inside `src/server/modules/*/service.ts`. This is what makes the modules testable
and what lets a future Python worker or mobile app reuse them through the API rather than
duplicating rules.

## 4. Multi-tenancy

Two independent layers. Either alone is a breach waiting to happen.

**Layer 1 — application scoping.** Every tenant-owned table has a non-null `organization_id`.
Every service function takes a `Ctx { orgId, userId, role, siteScope }` as its first argument and
every query filters on `ctx.orgId`. A lint rule forbids importing the raw Prisma client outside
`src/server/db`.

**Layer 2 — Postgres RLS.** Every tenant table has RLS enabled with:

```sql
CREATE POLICY tenant_isolation ON incidents
  USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```

The application connects as a role **without** `BYPASSRLS`. Migrations run as a separate
privileged role.

```ts
// src/server/db/tenant.ts
export async function withTenant<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // set_config(_, _, true) = LOCAL to this transaction; safe with connection pooling
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}::text, true)`;
    return fn(tx);
  });
}
```

Consequences to accept: every request is one transaction; PgBouncer must run in
**transaction** pooling mode; the anonymous-report path resolves the org from the site token
*before* opening the tenant transaction.

**The recurring trap.** Anything that must decide *which* tenant a request belongs to runs
before `app.current_org_id` is set, and is therefore blocked by the very policies protecting it.
It has bitten three times during the build — the job runner enumerating organizations, login
resolving a user's memberships, and the anonymous-report endpoint resolving its site token. Each
time the symptom was silence, not an error: zero rows, which reads as "no data". The rule is that
such a lookup never reads a table directly; it goes through a narrow `SECURITY DEFINER` function
that returns only what is needed to establish context (`app.active_organization_ids`,
`app.user_memberships`, `app.resolve_site_token`). Granting `BYPASSRLS` would "fix" all three and
disable tenant isolation everywhere — never do that.

**Verification:** an automated test suite (`tests/tenancy.spec.ts`) creates two orgs and asserts
that every list endpoint returns zero rows for the wrong org, and that a direct Prisma query
without `withTenant` returns zero rows. This suite is a merge gate.

## 5. Data access patterns

- **Reads for lists**: keyset pagination (`cursor` = `(created_at, id)`), never `OFFSET` past
  page 20. Default page size 25, max 100.
- **Dashboard "current state" tiles** (open, overdue): live SQL against partial indexes.
- **Dashboard trend tiles**: materialized views `mv_incident_daily`, `mv_action_daily`, refreshed
  by a cron job every 30 min with `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
- **Search**: a generated `search_vector tsvector` column with a GIN index, weighted
  A=reference+title, B=description, C=location/category.
- **Soft delete**: `deleted_at` on user-deletable entities only (attachments, comments, drafts).
  Incidents, investigations, actions and audit events are never deleted, only status-transitioned.

## 6. Reference numbers

`INC-2026-0042`, `ACT-2026-0117`. Gapless per organization per year per entity type, generated by
a `SELECT ... FOR UPDATE` on a `reference_sequences` row inside the same transaction as the insert.
Prefix is configurable per org (some customers require their own scheme). Collisions are impossible;
the row lock is held for microseconds.

## 7. File handling

1. Client requests `POST /api/v1/attachments/presign` with filename, mime, size, and the target entity.
2. Server validates: mime against an allowlist, size ≤ 15 MB (≤ 100 MB for video, plan-gated),
   the user's permission on the target entity, and the org's storage quota.
3. Server returns a presigned PUT URL (5-min expiry) and creates an `attachments` row with
   `upload_status = PENDING` and a key of `org/{orgId}/{entityType}/{entityId}/{uuid}.{ext}`.
4. Client PUTs directly to R2, then calls `POST /api/v1/attachments/{id}/complete`.
5. Server HEADs the object to confirm size/type, sets `UPLOADED`, and queues a thumbnail job for images.
6. Reads are presigned GET URLs with a 15-min expiry, issued only after a permission check.
   **No object is ever public.**
7. A nightly job deletes `PENDING` rows older than 24 h and their orphaned objects.

Stripping EXIF GPS is **not** done — location is evidence in an EHS context. It is surfaced in the UI instead.

## 8. Background jobs & scheduling

| Job | Schedule | Work |
|---|---|---|
| `notify.dispatch` | on demand | Fan out one notification to its channels, record delivery, retry 3× |
| `reminders.actions` | hourly | Actions due in 7/3/1 days → notify owners (site-local 09:00 window) |
| `escalations.actions` | hourly | Overdue ≥1d, ≥7d, ≥21d → tiered escalation per notification rules |
| `reminders.investigations` | hourly | Investigation due in 2 days / overdue |
| `digest.hourly` | hourly | Batch low-severity report notifications |
| `digest.weekly` | Mon 08:00 per site tz | Weekly summary email (+ AI narrative when enabled) |
| `analytics.refresh` | every 30 min | Refresh materialized views |
| `exports.generate` | on demand | Large CSV/XLSX/PDF → R2 → email link |
| `attachments.cleanup` | daily 02:00 | Orphan and expired-pending cleanup |
| `trial.check` | daily 06:00 | Trial expiry warnings and read-only transitions |
| `ai.narrative` | Mon 07:00 | Draft executive narratives ahead of the digest |

Idempotency: every handler is safe to run twice. Reminder jobs write a
`notification_log (entity_id, rule_key, scheduled_for)` unique row before sending; a duplicate
insert is caught and the send is skipped.

## 9. External integrations

### 9.1 Email (Resend)
Transactional templates as React Email components: invite, verify, reset, assignment, reminder,
escalation, digest, export-ready. All include the org name, a deep link, and an unsubscribe link
for digests only (never for assignments). SPF/DKIM/DMARC configured per sending domain.

### 9.2 AI (Anthropic)
Single module `src/server/services/ai` exposing typed functions (`summarizeReport`,
`suggestClassification`, `suggestWhyQuestions`, `suggestActions`, `draftNarrative`,
`findDuplicates`). Every call: org-scoped API budget check → prompt build from a versioned
template → call with a 20 s timeout → parse structured output with Zod → log to `ai_interactions`
→ return. Any failure returns `null` and the caller degrades to manual. Prompts live in
`services/ai/prompts/*.ts` and are versioned so output changes are traceable.

### 9.3 WhatsApp (Meta Cloud API)
Webhook verified by signature (`X-Hub-Signature-256`). Session state in a `whatsapp_sessions`
table keyed by phone, TTL 30 min. Outbound uses approved templates only outside the 24 h window.
**Start Meta Business verification and template submission in Sprint 1** — approval takes weeks and
is the critical path for E11, not the code.

### 9.4 Payments
Stripe for card/international; a local rail (Flutterwave / ClickPesa / Selcom for M-Pesa) behind a
`PaymentProvider` interface so the second provider is a file, not a refactor.
Webhooks are signature-verified and idempotent on the provider event id.

## 10. Environments & deployment

| Env | Host | Data | Purpose |
|---|---|---|---|
| local | Docker Compose | seeded demo tenant | development |
| preview | per-PR container | ephemeral, seeded | review |
| staging | small VPS | anonymised copy | pre-release + demos |
| production | VPS (4 vCPU / 8 GB / 160 GB NVMe to start) | live | customers |

Production Compose: `caddy`, `web` (×2), `worker`, `postgres`, `backup` (pgBackRest or
`wal-g` to R2). Zero-downtime deploys by starting the new `web` containers, waiting for
`/api/health` to pass, then draining the old ones via Caddy.

CI (`ci.yml`): typecheck → lint → unit/integration (Vitest with a Postgres service) → build →
Playwright E2E on the 5 critical journeys → tenancy isolation suite. All gates block merge.
CD (`deploy.yml`): on `main`, build image → push to GHCR → SSH deploy → migrate → health check →
auto-rollback to the previous tag on failure.

Migrations run as a separate step before the new containers accept traffic, and must be
backward-compatible with the running version (expand/contract: add nullable → backfill → switch
code → drop in a later release).

## 11. Security

| Control | Implementation |
|---|---|
| Transport | TLS 1.3 via Caddy, HSTS 1 year with preload |
| At rest | Full-disk encryption on the VPS + R2 SSE; `contact_encrypted` on anonymous reports uses app-level AES-256-GCM with a KMS-held key |
| Passwords | Argon2id (m=64MB, t=3, p=4), zxcvbn ≥ 3, breach check against HIBP k-anonymity |
| Sessions | DB-backed, httpOnly/secure/sameSite=lax, 12 h idle / 30 d absolute, revoked on password change |
| MFA | TOTP (RFC 6238) + 10 single-use recovery codes; org-enforceable |
| Authorization | Three layers: middleware (authenticated), route (permission key), service (record-level policy). See [05-RBAC](05-RBAC-MATRIX.md) |
| Tenant isolation | App scoping + Postgres RLS (§4), with a CI-gated isolation test suite |
| Input | Zod at every boundary; Prisma parameterisation; raw SQL only via tagged templates |
| Output | React escaping; DOMPurify on the single rich-text field; CSP with nonces, no `unsafe-inline` |
| Uploads | Mime allowlist + magic-byte sniff, size caps, non-executable content-disposition, served only via presigned URLs from a separate origin |
| Rate limits | Auth 20/min/IP, anonymous reports 10/h/IP, API 300/min/user, AI 60/h/org |
| Secrets | Environment only, never in the repo; rotated quarterly; `.env*` gitignored |
| Headers | CSP, X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy |
| Audit | Append-only `audit_events`; the app role has INSERT and SELECT only |
| Dependencies | Dependabot + `pnpm audit` in CI; a high/critical vulnerability blocks deploy |
| Backups | Nightly full + 15-min WAL to R2, encrypted; monthly restore drill recorded in `docs/runbooks/` |
| Incident response | Runbook with severity levels, a 72-hour breach-notification path, and a contact tree |

## 12. Definition of Done (every ticket)

1. Acceptance criteria from the PRD met and demonstrable in the UI.
2. Unit tests on service logic; integration test on the happy path plus one authorization denial.
3. Tenant isolation asserted for any new tenant-owned table or endpoint.
4. Audit event emitted for any state change.
5. Zod schema shared between client and server; no unvalidated input reaches a service.
6. Loading, empty, error and permission-denied states implemented.
7. Mobile viewport (360 px) verified for anything a reporter or action owner touches.
8. Product event emitted per the PRD taxonomy.
9. `pnpm typecheck && pnpm lint && pnpm test` green; no new `any` in `src/server`.
10. OpenAPI updated for any API change.

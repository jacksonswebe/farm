# 08 — Hosting Decision & Deployment Runbook

**Decision: Vercel + Neon for the pilot. Revisit at the triggers in §3.**
Decided 2026-09-08, superseding the VPS recommendation recorded below.

**Why the change.** The recommendation in §2 still stands on its technical merits, and the
Docker path is committed and working (`docker/`, `.github/workflows/deploy.yml`). It was not
adopted because the available VPS is shared with other live services: ports 80/443 are taken,
and standing up this stack there risks an outage in something already running. Vercel gets the
pilot live today with zero blast radius on that host.

**What it costs, concretely.** The worker objection in §2.1 is real and had to be answered
rather than ignored. It was answered by making the jobs transport-agnostic:
`src/server/jobs/handlers/*` are plain functions that know nothing about HTTP, invoked today by
Vercel Cron through `/api/cron/[job]` and tomorrow by a pg-boss worker with no change to a
handler. This works here only because every job in the profile is *scheduled* — hourly
reminders, daily escalations, weekly digests, a 30-minute view refresh. Nothing needs
sub-minute latency. Were that to change, this decision would have to change with it.

Two things this makes non-negotiable, both now implemented and tested:
- **Every handler must be idempotent**, because an HTTP cron trigger retries. `notification_log`
  holds the claim; a re-run sends nothing.
- **`CRON_SECRET` must be set.** Without it `/api/cron/*` is a public denial-of-service handle.

---

## 1. The question, correctly framed

"GitHub or Vercel" is not the choice. GitHub Pages serves static files; this application needs a
Node server, a Postgres database and a persistent background worker. GitHub is the **pipeline**
(Actions builds and deploys), not the **host**. The real choice is Vercel vs. a VPS.

## 2. Why not Vercel

Vercel is excellent at what it is for. This application is not that.

### 2.1 The blocker: the worker cannot live on Vercel

The escalation engine is not a peripheral feature — it *is* the product. Reminders at T−7/−3/−1
days, overdue notices at +1d, supervisor escalation at +7d, executive at +21d, weekly digests,
materialized-view refreshes. That is a long-running process consuming a durable queue.

Vercel runs serverless functions with an execution ceiling. It has no persistent process. So on
Vercel the architecture becomes:

| | Vercel path | VPS path |
|---|---|---|
| Web | Vercel | one container |
| Database | Neon / Supabase | one container |
| **Worker** | **Railway / Fly / a VPS anyway** | one container |
| Object storage | R2 | R2 |
| Vendors to manage | **4** | **1 + R2** |
| Bills, dashboards, status pages, failure modes | 4 | 2 |

You end up running a VPS regardless — just a second one, badly integrated, alongside three other
vendors. That is more operational surface than the thing I am recommending, not less.

### 2.2 Four more reasons, in order of weight

**Data residency is a sales objection you will meet.** Buyers in Tanzania, Kenya, Nigeria and the
Gulf ask where injury and occupational-health records are stored; some will require an answer in a
contract. A Compose stack is portable — the same four files run in a customer's own VPC, which
converts an objection into a priced Enterprise add-on ($400/mo in
[07-COMMERCIAL §2](07-COMMERCIAL-MODEL.md#2-pricing-hypothesis)). A Vercel-coupled build cannot
follow you there without a rewrite.

**Connection topology.** `withTenant()` opens a transaction and sets `app.current_org_id` with
`SET LOCAL`. That is compatible with transaction-mode pooling, so it *works* on serverless — but
every serverless invocation is a potential new connection, so you need a pooler in front, tuned,
and you are now debugging connection exhaustion instead of building the product. One long-lived
Node process with a 10-connection pool has none of this.

**Cost, at a margin that already works.** €20/month for the whole stack versus roughly
$20/seat/month plus function invocations, bandwidth and a managed Postgres. At 97% gross margin
this is not decisive — but at Starter pricing calibrated for an African SME, per-tenant COGS is
something you should keep near zero on principle.

**Egress.** Evidence photos are 5–15 MB each, and the audit PDF pack bundles them. R2 has zero
egress fees; serving that traffic through a metered platform is a bill that grows with exactly the
usage you want to encourage.

### 2.3 What you give up — stated honestly

| Vercel gives you | What it costs you here | Mitigation |
|---|---|---|
| Preview deploy per PR | Real loss — it is a genuinely good review loop | A staging VPS + `docker compose` per branch covers the 80% case |
| Zero ops | You own patching, backups, uptime | ~1 hour/month with Compose + automated backups; the runbook below is the whole job |
| Global edge CDN | Marginal — your users are regionally concentrated and every page is dynamic and authenticated | Caddy handles compression and HTTP/3; static assets can go behind Cloudflare free |
| Instant rollback | You build it | Built — see `deploy.yml` and §5 |

This is a real trade. It is the right one **because the worker forces a VPS into the picture no
matter which path you pick.**

## 3. Revisit triggers — move off Vercel when any of these is true

- **A customer contractually requires in-country or in-VPC data residency.** This is the most
  likely trigger and it is a sales event, not an engineering one. The Docker stack below is the
  answer; it is already built.
- **A job needs sub-minute latency**, or a job exceeds the serverless execution ceiling
  (`maxDuration` is set to 300s on the cron route). Real-time work breaks the cron model.
- **Serverless connection churn against Postgres becomes the bottleneck** despite pooling.
- **Vercel spend approaches the ~€20/month the VPS stack costs**, with bandwidth on evidence
  photos the most likely cause.

The migration is deliberately small: point `DATABASE_URL` at the new Postgres, run
`docker compose -f docker/compose.prod.yml up -d`, and let the pg-boss worker call the same
`JOB_HANDLERS` map that Vercel Cron calls today. No handler changes.

## 3a. Vercel setup

| Concern | Setting |
|---|---|
| Region | `fra1` (closest Vercel region to East Africa; `regions` in `vercel.json`) |
| Database | Neon or Supabase Postgres. Use the **pooled** connection string for `DATABASE_URL` and the **direct** one for migrations — `SET LOCAL` needs transaction-mode pooling, which both provide |
| App DB role | `safesphere_app`, **NOBYPASSRLS** (`scripts/create-app-role.sql`). Never connect the app as the Neon owner role — it bypasses RLS and every isolation policy becomes inert |
| Cron | `vercel.json` → 7 schedules, all UTC. 06:00 UTC = 09:00 Africa/Dar_es_Salaam |
| Secrets | Project → Settings → Environment Variables, from `.env.example` |
| Build | `pnpm build`. `output: 'standalone'` is applied only when `BUILD_TARGET=docker`, so Vercel builds normally |

**The one setup step that is easy to get wrong and fatal:** connecting as the database owner.
Run `scripts/create-app-role.sql` and verify with `scripts/verify-tenancy.sh` against the
deployed database before any real data exists.

## 3b. First deploy — the exact sequence

Roughly 30 minutes. Steps 3 and 5 are the ones that are quietly fatal if skipped.

**1. Database.** Create a Neon project in a region near your users (`eu-central-1` is the closest
to East Africa). Copy both connection strings — the **pooled** one and the **direct** one.

**2. Apply the schema** using the *direct* string:
```bash
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f db/seed.sql        # demo tenant, optional but do it
DATABASE_URL="$DIRECT_URL" node scripts/set-demo-passwords.mjs
```

**3. Create the application role — do not skip this.**
```bash
psql "$DIRECT_URL" -v app_password="'<generate one>'" -f scripts/create-app-role.sql
```
Connecting the app as the Neon owner role bypasses RLS and every tenant-isolation policy in the
schema becomes decorative. The script refuses to finish if the role ends up with BYPASSRLS.
Build `DATABASE_URL` from the **pooled** host with `safesphere_app` as the user.

**4. Vercel.** Import the GitHub repo (framework auto-detects as Next.js). Set environment
variables from `.env.example` — at minimum:

| Variable | Value |
|---|---|
| `DATABASE_URL` | pooled Neon URL, user `safesphere_app` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `FIELD_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -base64 32` — without it `/api/cron/*` is a public DoS handle |
| `S3_*` | Cloudflare R2 (or any S3-compatible bucket). **Required in production** — `createStorage()` throws rather than silently writing evidence to an ephemeral serverless disk |
| `RESEND_API_KEY`, `MAIL_FROM` | Optional at first. Without them email falls back to a console driver that logs instead of sending, so notifications still record correctly |
| `NODE_ENV` | `production` (Vercel sets this) |

`S3_*`, `RESEND_API_KEY` and `ANTHROPIC_API_KEY` can wait — attachments, email and AI are not on
the first-deploy path.

**5. Verify against the deployed database, before real data exists:**
```bash
PGHOST_=<neon-host> DB=<db> APP_USER=safesphere_app APP_PASS=<pw> bash scripts/verify-tenancy.sh
curl -s https://<your-app>.vercel.app/api/health | jq
```
Health must report `"tenancy": {"ok": true}` — that asserts `app.current_org()` is NULL with no
context, i.e. RLS is armed. If it is false, stop and fix step 3.

**6. Confirm cron is live.** Vercel → Project → Cron Jobs should list 7 schedules from
`vercel.json`. Trigger one by hand:
```bash
curl -H "authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/cron/analytics.refresh
```

**7. Sign in** as `hse@demo.safesphere.app` / `Demo!2345` and walk the demo: dashboard →
events → report an event. **Then change or remove the demo passwords** before the URL is shared.

### Post-deploy checklist
- [ ] `/api/health` returns `status: ok` and `tenancy.ok: true`
- [ ] `verify-tenancy.sh` passes against the production database
- [ ] Cron jobs listed in Vercel and one manually triggered successfully
- [ ] `CRON_SECRET` set (confirm an unauthenticated `/api/cron/*` call returns 401)
- [ ] Demo credentials rotated or the demo tenant removed before sharing the URL
- [ ] Neon point-in-time restore confirmed available on your plan

## 4. The stack

```
Hetzner CX42 (or local equivalent) — 4 vCPU / 8 GB / 160 GB NVMe — ~€20/month
│
├─ caddy      TLS, HTTP/3, security headers, load balancing   :80 :443
├─ web ×2     Next.js standalone                              internal :3000
├─ worker ×1  pg-boss consumer + cron
├─ postgres   PostgreSQL 16, WAL archiving on
└─ backup     wal-g → R2 (nightly base + continuous WAL)

external: Cloudflare R2 (evidence, exports, backups) · Resend · Anthropic · Sentry
```

Files: `docker/Dockerfile` (four targets: web, worker, migrator, plus the shared builder),
`docker/compose.yml` (local), `docker/compose.prod.yml` (production), `docker/Caddyfile`.

**Why one image for web and worker:** the worker imports the same service modules the API does.
Separate images let escalation logic drift from request logic — and a drifted escalation rule is a
missed corrective action, which is the failure the product exists to prevent.

**Why `dynamic a` upstreams in Caddy:** it re-resolves Docker's DNS every 5 seconds and
health-checks each replica, so `--scale web=2` load-balances and rolling deploys drain cleanly
with no Caddy config change and no external load balancer.

## 5. Deploy pipeline

`.github/workflows/ci.yml` — 6 jobs, all merge gates:

| Job | Gate |
|---|---|
| `static` | typecheck, lint, and a hard failure on `any` in `src/server` |
| `test` | unit + integration, **plus a Prisma-vs-`db/schema.sql` drift check** |
| `tenancy` | `scripts/verify-tenancy.sh` — the 5 isolation assertions |
| `build` | production build succeeds |
| `e2e` | 5 critical Playwright journeys |
| `contract` | `api/openapi.yaml` lints |

`.github/workflows/deploy.yml` — on merge to `main`:

```
green CI → build web/worker/migrator → push to GHCR
        → scp compose files → pre-deploy pg_dump → run migrations
        → rolling restart (Caddy drains) → health check ×30
        → record last-good tag   |   on failure: auto-rollback
```

Rollback is also manual on demand: **Actions → Deploy → Run workflow → `rollback_to: <tag>`.**

**Migrations are never auto-reverted.** Expand/contract
([03-DATA-MODEL §8](03-DATA-MODEL.md#8-migration-policy)) guarantees the previous code runs
against the new schema, so rolling back *code* is always safe. Reverting a migration is a
deliberate human decision, never an automated one.

## 6. Host provisioning (once)

```bash
# 1. Harden
adduser deploy && usermod -aG docker deploy
# SSH keys only: PasswordAuthentication no, PermitRootLogin no
ufw allow 22,80,443/tcp && ufw enable
apt install -y unattended-upgrades fail2ban

# 2. Layout
mkdir -p /opt/safesphere/backups && chown -R deploy:deploy /opt/safesphere

# 3. Secrets — host-held, mode 600, NEVER in the repository
#    Populate from .env.example; generate with `openssl rand -base64 32`
vim /opt/safesphere/.env && chmod 600 /opt/safesphere/.env

# 4. Database roles — the app role must NOT have BYPASSRLS
psql -f db/schema.sql
psql -c "CREATE ROLE safesphere_app LOGIN PASSWORD '…' NOBYPASSRLS;"
psql -c "CREATE ROLE safesphere_migrate LOGIN PASSWORD '…';"   # privileged, migrations only
#    then the GRANTs at the end of db/schema.sql
```

GitHub secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`.
GitHub variables: `APP_DOMAIN`.

## 7. Backup & restore

Nightly base backup + continuous WAL archiving to R2. **RPO 15 minutes, RTO 4 hours.**

```bash
# Restore to a point in time
docker compose -f compose.prod.yml stop web worker
wal-g backup-fetch /var/lib/postgresql/data LATEST
echo "restore_command = 'wal-g wal-fetch %f %p'
recovery_target_time = '2026-09-08 14:30:00+03'" >> postgresql.auto.conf
touch /var/lib/postgresql/data/recovery.signal
docker compose -f compose.prod.yml up -d postgres
```

**A backup you have never restored is not a backup.** Restore into staging on the first Monday of
every month, record the date and the measured RTO in this file, and treat a missed drill as a P1.

| Drill date | RTO measured | By |
|---|---|---|
| _(first drill due before the pilot starts — Sprint 4 exit gate)_ | | |

## 8. Monitoring

| Signal | Tool | Alert |
|---|---|---|
| Uptime | external HTTP check on `/api/health` | 2 failures in 2 min → phone |
| Errors | Sentry | any new issue, or a spike |
| Disk | node exporter / cron | >80% → warn, >90% → page |
| Queue depth | `/api/health` reports pg-boss backlog | >100 pending for 10 min → page |
| Backup freshness | wal-g check | no base backup in 26 h → page |
| Cert expiry | Caddy renews automatically | <14 days → warn |

Alerts go to a phone, not an inbox. An alert nobody sees is a log line.

## 9. First deploy checklist

- [ ] VPS provisioned and hardened (§6)
- [ ] DNS A/AAAA → host; Caddy has issued a certificate
- [ ] `/opt/safesphere/.env` populated, mode 600
- [ ] `safesphere_app` role confirmed **NOBYPASSRLS**
- [ ] `bash scripts/verify-tenancy.sh` passes against production
- [ ] Backup ran; **one restore drill completed and timed**
- [ ] Sentry + uptime alerting to a real phone
- [ ] Health check green; a deliberate rollback tested once
- [ ] Demo tenant seeded on staging for sales

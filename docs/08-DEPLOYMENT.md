# 08 — Hosting Decision & Deployment Runbook

**Decision: single VPS running Docker Compose, deployed by GitHub Actions. Not Vercel.**
Decided 2026-09-08. Revisit triggers in §3.

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

## 3. Revisit triggers

Change this decision when any of these become true — not before:

- More than ~200 tenants, or the box sustains >70% CPU at peak
- Ops exceeds one day per month
- You hire a team that would rather buy a platform than run one
- A customer requires multi-region active-active

At that point the move is **managed Kubernetes or a platform like Fly/Render**, not Vercel — the
worker constraint does not change.

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

# SafeSphere EHS — MVP PRD & Technical Blueprint

Implementation-ready specification set for **SafeSphere EHS**, a multi-tenant SaaS
platform for workplace Environmental, Health & Safety management.

Source: `Integrated EHS Platform — Prospect Presentation & MVP Product Blueprint` (10-page prospect deck).
This repo converts that concept document into a buildable product spec.

---

## The one sentence that defines the MVP

> A worker reports an event on a phone in under 60 seconds; the HSE manager investigates it,
> assigns corrective actions with owners and deadlines; the system chases those owners until
> the actions are verified closed; and management sees the whole picture on a live dashboard.

Everything that does not serve that sentence is out of MVP scope.

---

## Document map

| # | Document | What it answers |
|---|----------|-----------------|
| 00 | [Source Analysis & Decisions](docs/00-SOURCE-ANALYSIS.md) | What the proposal got right, what is missing, what we changed and why |
| 01 | [MVP PRD](docs/01-PRD-MVP.md) | Personas, scope, epics, user stories, acceptance criteria, non-functionals |
| 02 | [Technical Blueprint](docs/02-TECHNICAL-BLUEPRINT.md) | Stack, architecture, tenancy, folder structure, jobs, AI layer, deployment |
| 03 | [Data Model](docs/03-DATA-MODEL.md) | Entities, relationships, state machines, retention |
| 04 | [API Spec](docs/04-API-SPEC.md) | Endpoint contracts, errors, pagination, idempotency, webhooks |
| 05 | [RBAC Matrix](docs/05-RBAC-MATRIX.md) | Roles × permissions, enforcement layers |
| 06 | [Build Plan](docs/06-BUILD-PLAN.md) | 10-week sprint backlog, ticket-level tasks, definition of done |
| 07 | [Commercial Model](docs/07-COMMERCIAL-MODEL.md) | Pricing, billing enforcement, payments, unit economics, GTM motion |
| 08 | [Deployment](docs/08-DEPLOYMENT.md) | Hosting decision (VPS, not Vercel), pipeline, backup/restore, runbook |

Machine-readable artifacts:

| Path | Contents |
|------|----------|
| `db/schema.sql` | Complete PostgreSQL DDL — tables, enums, indexes, RLS policies, triggers |
| `db/seed.sql` | Demo tenant, users, sites, categories and one full incident→CAPA chain |
| `api/openapi.yaml` | OpenAPI 3.1 contract for the MVP surface |
| `.env.example` | Every environment variable the system reads |
| `docker/` | Dockerfile (web/worker/migrator targets), Compose stacks, Caddyfile |
| `.github/workflows/` | CI (6 merge gates) and zero-downtime deploy with auto-rollback |
| `scripts/verify-tenancy.sh` | The 5 tenant-isolation assertions — a CI merge gate |

---

## Stack (decided, not optional)

TypeScript end to end. One repo, one language, one deploy target.

- **App**: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind + shadcn/ui
- **API**: Next.js Route Handlers (REST, `/api/v1/*`) + Zod validation
- **DB**: PostgreSQL 16 + Prisma, tenant isolation via Row-Level Security
- **Jobs**: pg-boss (Postgres-backed queue + cron — no Redis)
- **Files**: Cloudflare R2 (S3-compatible), presigned direct upload
- **Auth**: Auth.js v5, credentials + magic link, TOTP MFA
- **AI**: Anthropic API behind an internal `ai-service` module with logging + human review
- **Notify**: Resend (email), Africa's Talking (SMS), WhatsApp Cloud API
- **Deploy**: Docker Compose on a single VPS behind Caddy; GitHub Actions CI/CD

Hosting was decided against Vercel — the escalation worker is a long-running process that
serverless cannot host, so a VPS is required either way. Full reasoning:
[docs/08-DEPLOYMENT.md](docs/08-DEPLOYMENT.md).

Rationale and the rejected alternatives (incl. the proposal's Next.js + FastAPI split)
are in [docs/00-SOURCE-ANALYSIS.md](docs/00-SOURCE-ANALYSIS.md#d1-single-typescript-monolith-not-nextjs--fastapi).

---

## Getting started (once code lands)

```bash
cp .env.example .env.local        # fill in secrets
docker compose up -d postgres     # local Postgres 16
pnpm install
pnpm db:push && pnpm db:seed      # schema + demo tenant
pnpm dev                          # http://localhost:3000
```

Demo login after seeding: `hse@demo.safesphere.app` / `Demo!2345` (see `db/seed.sql`).

---

## Status

Specification complete — ready for Sprint 0. Start at
[docs/06-BUILD-PLAN.md](docs/06-BUILD-PLAN.md).

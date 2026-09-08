# 00 — Source Analysis, Gaps & Architectural Decisions

Analysis of `Integrated EHS Platform — Prospect Presentation & MVP Product Blueprint`
(SafeSphere EHS, 10 pages, 20 sections) and the decisions taken to make it buildable.

---

## 1. What the proposal gets right

| Strength | Why it matters for the build |
|---|---|
| The MVP is correctly scoped around one loop: report → investigate → act → verify → close | This is the only EHS loop that a customer will pay for on day one. It is also demonstrable in a 15-minute sales call. |
| Multi-tenant SaaS from the start | Retrofitting tenancy is the single most expensive rewrite in B2B SaaS. Correct call. |
| Audit trail listed as a **Must**, not a nice-to-have | Audit-evidence retrieval is the actual buying trigger for ISO 45001 customers. |
| AI positioned as assistive with human approval | Keeps the product outside the liability trap of "the software told me the root cause". |
| Feature catalogue separated from MVP scope | Gives the architecture a known expansion path (14 future modules) without building them. |
| Recurring SaaS, not one-time install | The only model that reaches meaningful ARR. |

---

## 2. Gaps in the proposal that block implementation

These are the things a developer cannot start without. Each is resolved in this spec set.

| # | Gap in source document | Resolved in |
|---|---|---|
| G1 | No user stories or acceptance criteria — only feature names | [01-PRD](01-PRD-MVP.md) §5–§13 |
| G2 | No state machines. "Status" is named but never enumerated | [03-DATA-MODEL](03-DATA-MODEL.md) §4 |
| G3 | No severity/risk scoring definition — "severity" appears 6× with no scale | [01-PRD](01-PRD-MVP.md) §7.3, risk matrix |
| G4 | No SLA/escalation rules — "reminders" and "escalation" are undefined timers | [01-PRD](01-PRD-MVP.md) §10, [02-BLUEPRINT](02-TECHNICAL-BLUEPRINT.md) §8 |
| G5 | Permissions described as prose, not a matrix; no record-level scoping rules | [05-RBAC](05-RBAC-MATRIX.md) |
| G6 | Tenant isolation asserted but no mechanism specified | [02-BLUEPRINT](02-TECHNICAL-BLUEPRINT.md) §4 (Postgres RLS) |
| G7 | Entities listed but no cardinalities, keys, indexes or DDL | [03-DATA-MODEL](03-DATA-MODEL.md) + `db/schema.sql` |
| G8 | No API contract | [04-API-SPEC](04-API-SPEC.md) + `api/openapi.yaml` |
| G9 | Offline behaviour never mentioned — fatal for mine/construction sites with no signal | [01-PRD](01-PRD-MVP.md) §8.4 (offline-queued reporting) |
| G10 | No anonymous reporting path — a legal requirement in several jurisdictions and a major adoption driver | [01-PRD](01-PRD-MVP.md) §7.6 |
| G11 | Roadmap phases have no durations, no team shape, no sequencing | [06-BUILD-PLAN](06-BUILD-PLAN.md) |
| G12 | Commercial model has no numbers, no billing enforcement, no payment rails | [07-COMMERCIAL](07-COMMERCIAL-MODEL.md) |
| G13 | Success metrics named but not instrumented — no event taxonomy | [01-PRD](01-PRD-MVP.md) §14 |
| G14 | No data-migration path — every real customer arrives with a spreadsheet of open actions | [01-PRD](01-PRD-MVP.md) §7.9 (CSV import) |
| G15 | "WhatsApp reporting" listed as Should with no acknowledgement of Meta template approval lead time | [02-BLUEPRINT](02-TECHNICAL-BLUEPRINT.md) §9.3 — start the approval in Sprint 1, ship in Sprint 5 |

---

## 3. Scope corrections (things cut or added)

### Cut from the stated MVP

| Item | Reason |
|---|---|
| **"Basic Reports" as PDF generation** | Deferred to Sprint 5. CSV/XLSX export covers the Sprint-1 buyer objection; PDF report layout is a week of work for a cosmetic win. Incident PDF stays (it is the auditor artifact); investigation/action PDFs move to R2. |
| **AI trend detection** | Statistically meaningless below ~200 incidents. Ships in Release 2 when tenants have data. MVP AI is summarize + classify + RCA-prompt only. |
| **SMS notifications in MVP** | Email + in-app + WhatsApp covers it. SMS is a per-message cost with no incremental adoption benefit while WhatsApp penetration in target markets is >90%. Kept in the schema, disabled by config. |

### Added to the MVP (not in the source, but non-negotiable)

| Item | Reason |
|---|---|
| **Offline-first reporting (PWA + queued submissions)** | Target industries are mining, construction and agriculture. A reporting tool that requires connectivity at the point of the event does not get used at the point of the event. This is the difference between adoption and shelfware. |
| **Anonymous / low-friction reporting link** | Near-miss and hazard volume is the leading indicator the whole dashboard depends on. Requiring a login before a hazard report suppresses exactly the data the product sells. |
| **Human-readable reference numbers (`INC-2026-0042`)** | Every safety conversation on a real site happens verbally or over WhatsApp. UUIDs are unusable in that conversation. |
| **CSV importer for open actions** | Removes the migration objection during the pilot. Two days of work, closes deals. |
| **Billing + plan-limit enforcement in the core schema** | Adding metering after launch means reconciling usage retroactively. Cheap now, expensive later. |

---

## 4. Architectural decisions

### D1. Single TypeScript monolith, not Next.js + FastAPI

The proposal recommends "Next.js / React" front end with "FastAPI or equivalent" backend.
**Rejected for the MVP.**

| | Proposed (Next + FastAPI) | Decided (Next.js full-stack) |
|---|---|---|
| Languages | 2 (TS + Python) | 1 (TS) |
| Deployables | 2 + CORS + a duplicated auth story | 1 |
| Type safety across the boundary | Codegen pipeline to maintain | Shared Zod schemas + inferred types |
| Time to first shippable increment | ~+2 weeks of plumbing | Day 1 |
| Team it assumes | ≥2 specialists | 1–3 generalists |

The only genuine argument for Python here is the AI layer — and the Anthropic TypeScript SDK
removes it. If a future module needs Python (predictive analytics, CV on site photos), it is
added as a **separate worker service consuming the same Postgres**, not as the primary API.
That door stays open; we just do not pay for it in Sprint 1.

**Trigger to revisit:** first data-science module, or backend team headcount ≥ 4.

### D2. Postgres Row-Level Security for tenancy, not application-only filtering

Application-level `where: { orgId }` filtering fails open — one forgotten clause is a
cross-tenant data breach, and in an EHS product that means one customer reading another
customer's injury records. RLS fails closed: a missing session variable returns zero rows.

Both layers are used. Prisma always scopes by `organization_id`; RLS is the backstop.
Details in [02-BLUEPRINT §4](02-TECHNICAL-BLUEPRINT.md#4-multi-tenancy).

**Cost:** every request runs inside a transaction that sets `app.current_org_id`. Accepted.

### D3. pg-boss for jobs, not Redis/Celery/Inngest

Reminders, escalations, digests and notification fan-out are the job workload. Volume at MVP
scale is hundreds of jobs per day, not thousands per second. pg-boss gives durable queues plus
cron in the database that already exists — zero added infrastructure, zero added monthly cost,
and job state is visible in the same backups as the business data.

**Trigger to revisit:** >50 jobs/second sustained, or a need for multi-region workers.

### D4. Self-hosted VPS + Docker Compose, not Vercel/managed PaaS

Target buyers in Tanzania, Kenya, Nigeria and the Gulf routinely ask where safety and
occupational-health data is stored, and some will contractually require it. A Compose stack
on a €20/month Hetzner or a local provider is portable to a customer's own VPC when an
enterprise deal demands it — a Vercel-coupled build is not. Cost per tenant is also ~2 orders
of magnitude lower, which matters when the Starter tier is priced for an African SME.

**Trigger to revisit:** >200 tenants or an ops burden exceeding one day/month.

### D5. One `incidents` table for incident / near-miss / hazard / observation

The four report types share ~90% of their fields and their entire lifecycle. Four tables would
mean four APIs, four forms and four dashboard queries with identical logic. One table with a
`report_type` enum, plus a `category` reference table for tenant-specific taxonomies.

**Trigger to revisit:** when a type's field divergence exceeds ~6 unique columns — then use a
typed `details JSONB` extension, still in the same table.

### D6. Files never touch the application server

Presigned PUT direct to R2, presigned GET for reads, server only stores metadata. Keeps site
photos (5–15 MB each from a phone) off the app's request path and out of the container's disk.

---

## 5. Brutal truth for the business case

1. **The demo, not the feature list, closes the deal.** The proposal's own conclusion says this.
   Build the seeded demo tenant (`db/seed.sql`) in Sprint 0, before the login page is pretty.
   One complete incident → investigation → 5 Whys → CAPA → reminder → verification → dashboard,
   populated with realistic data, is the entire sales asset.

2. **The 14-module feature catalogue is a liability in front of a prospect.** It invites
   "come back when you have permits and training." Lead with the loop, and position the
   catalogue as a roadmap you are co-designing with the design partner.

3. **This product does not sell to workers, it sells to liability.** The buyer is the person
   who has to produce evidence during an audit or after a fatality. Price and pitch to audit
   retrieval time and CAPA closure rate — not to "digital transformation".

4. **Do not build past Sprint 3 without a signed design partner.** Two paying pilots at a
   discount, with a contractual commitment to weekly feedback, beat six more modules. If
   nobody will pilot, the scope is not the problem.

5. **The riskiest assumption is adoption at the point of the event**, not any technical piece.
   Offline PWA + anonymous link + WhatsApp are the three bets against it. Instrument
   `time_to_report` from day one; if the median is not falling in the pilot, the product is
   not working regardless of what the dashboard shows.

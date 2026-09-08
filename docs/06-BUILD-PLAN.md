# 06 — Build Plan

**10 weeks to a pilot-ready MVP.** Five two-week sprints plus a Sprint 0.
Assumed team: 1–2 full-stack TypeScript engineers, founder as PM/QA. A single engineer should
add ~50 % to every estimate and cut E10–E12 entirely.

---

## 1. Sequencing principle

Build the demo before the polish. By the end of Sprint 2 you must be able to walk a prospect
through report → investigate → 5 Whys → CAPA → verify → close → dashboard on seeded data.
Everything after that is making it real enough to run a company on.

```
S0  Foundation      auth, tenancy, schema, CI, deploy pipeline, seeded demo
S1  Report & triage  E2, E3 — capture and dispose of events
S2  Investigate      E4, E5 — the loop closes.  ⇦ DEMO-COMPLETE MILESTONE
S3  Chase & see      E6, E7 — notifications, escalation, dashboards
S4  Prove & harden   E8, E9, offline PWA, performance, security  ⇦ PILOT-READY
S5  Differentiate    E10 AI, E11 WhatsApp, E12 billing (as capacity allows)
```

---

## 2. Sprint 0 — Foundation (week 1–2)

Goal: an empty but correct system, deployed, with the demo tenant seeded.

| ID | Task | Est | Done when |
|---|---|---|---|
| S0-01 | Repo scaffold: Next.js 15, TS strict, Tailwind, shadcn, ESLint/Prettier | 1d | `pnpm dev` renders; `pnpm typecheck lint` clean |
| S0-02 | Docker Compose (postgres, app) + `.env.example` | 0.5d | `docker compose up` gives a working local DB |
| S0-03 | Apply `db/schema.sql`; generate `prisma/schema.prisma` to match | 1.5d | `prisma db pull` produces a client with no drift |
| S0-04 | `withTenant()` + Prisma client singleton + `Ctx` type | 1d | Tenancy suite (5 assertions in [03 §3](03-DATA-MODEL.md#3-multi-tenancy-in-the-schema)) passes |
| S0-05 | Auth.js v5: credentials, argon2id, sessions, email verify, reset | 2d | Sign up → verify → sign in → sign out |
| S0-06 | Org creation on signup + trial subscription + setup checklist | 1d | New signup lands in a working workspace |
| S0-07 | Permission registry + `requirePermission` + `policy.ts` pattern | 1d | Matrix from [05-RBAC](05-RBAC-MATRIX.md) encoded and unit-tested |
| S0-08 | App shell: nav, org switcher, role-aware menu, empty states | 1.5d | Every route renders for every role without a crash |
| S0-09 | Audit service (`recordAudit`) + History tab component | 1d | Any state change writes a row; the tab renders it |
| S0-10 | Error handling, logger, requestId, Sentry, `/api/health` | 1d | Errors carry a requestId; health gates the deploy |
| S0-11 | CI: typecheck, lint, unit, build, tenancy suite | 1d | Merge blocked on red |
| S0-12 | Staging VPS + Caddy + deploy workflow + nightly backup | 1.5d | `main` auto-deploys; a restore has been tested once |
| S0-13 | Seed the demo tenant (`db/seed.sql`) | 0.5d | 131 incidents, 94 actions, the full demo chain |
| S0-14 | **Start Meta WhatsApp Business verification** | 0.5d | Submitted — it takes weeks, so it starts now |

**Exit:** two engineers can work in parallel without stepping on tenancy, auth or CI.

## 3. Sprint 1 — Report & triage (week 3–4) · E2, E3

| ID | Task | Est | Story |
|---|---|---|---|
| S1-01 | Sites & departments CRUD + timezone handling | 1.5d | S1.3 |
| S1-02 | Taxonomy CRUD + system defaults on org creation | 1d | S1.4 |
| S1-03 | Users, invitations, roles, site scoping, deactivation | 2d | S1.2 |
| S1-04 | Reference number service (`app.next_reference`) | 0.5d | §6 blueprint |
| S1-05 | Report form — mobile-first, progressive disclosure, <60 s | 3d | S2.1 |
| S1-06 | Attachment pipeline: presign → PUT → complete → thumbnails | 2d | S2.1 |
| S1-07 | Draft save/resume | 0.5d | S2.4 |
| S1-08 | Report list + filters + keyset pagination | 1.5d | S8.1 |
| S1-09 | Report detail view with History tab | 1.5d | S2.6 |
| S1-10 | Triage queue with SLA colouring + bulk actions | 1.5d | S3.1 |
| S1-11 | Classify: severity, likelihood, derived risk, forced investigation | 1d | S3.2 |
| S1-12 | Acknowledge, reject, mark duplicate | 1d | S3.3, S3.4 |
| S1-13 | Anonymous report route + rate limit + captcha | 1.5d | S2.5 |
| S1-14 | E2E: submit → appears in triage → classified | 1d | — |

**Exit:** a real worker can file a real report and an HSE manager can dispose of it.

## 4. Sprint 2 — Investigate & act (week 5–6) · E4, E5 — **demo-complete**

| ID | Task | Est | Story |
|---|---|---|---|
| S2-01 | Assign investigator, due date by severity band | 1d | S4.1 |
| S2-02 | Investigation workspace + autosave | 2d | S4.2 |
| S2-03 | Timeline entries | 1d | S4.2 |
| S2-04 | Evidence and interviews | 1.5d | S4.2 |
| S2-05 | 5 Whys builder (3–7 steps, category, blame guardrail) | 2.5d | S4.3 |
| S2-06 | Findings + "create action from finding" | 1.5d | S4.4 |
| S2-07 | Submit / approve / return with guards | 1d | S4.5 |
| S2-08 | Action create form incl. hierarchy of control | 1.5d | S5.1 |
| S2-09 | My Actions view + progress updates + evidence | 2d | S5.2 |
| S2-10 | Extension request and approval | 1d | S5.2 |
| S2-11 | Verification with the owner≠verifier rule + auto follow-up | 1.5d | S5.3 |
| S2-12 | Incident closure with the open-actions guard | 1d | S5.4 |
| S2-13 | E2E: the entire loop, end to end | 1.5d | — |

**Exit — the milestone that matters:** the demo in the source proposal's conclusion is real.
Take it to prospects in week 6, not week 10.

## 5. Sprint 3 — Chase & see (week 7–8) · E6, E7

| ID | Task | Est | Story |
|---|---|---|---|
| S3-01 | pg-boss bootstrap, worker process, job registry | 1d | §8 blueprint |
| S3-02 | Notification service + in-app inbox | 1.5d | S6.1 |
| S3-03 | Email templates (React Email) + Resend | 1.5d | S6.1 |
| S3-04 | Reminder jobs (action T−7/−3/−1, investigation T−2) | 1.5d | S6.1 |
| S3-05 | Escalation jobs (overdue 1d / 7d / 21d tiers) | 1.5d | S6.1 |
| S3-06 | Digests: hourly batching, weekly summary, quiet hours | 1.5d | S6.3, S6.5 |
| S3-07 | Notification rules admin + per-user preferences | 1.5d | S6.1, S6.2 |
| S3-08 | Delivery tracking + retry + failure surfacing | 1d | S6.4 |
| S3-09 | `/dashboard/summary` — all current-state tiles in one query | 2d | §12.1 |
| S3-10 | Materialized views + refresh job + trend endpoints | 1.5d | §12.4 |
| S3-11 | Dashboard UI: 12 tiles, filters, click-through | 2.5d | §12.1 |
| S3-12 | Executive and site-scoped dashboard variants | 1.5d | §12.2–12.3 |

**Exit:** the system chases people without the HSE manager doing it, and management can see the
picture. This is the sprint that converts a demo into a purchase.

## 6. Sprint 4 — Prove & harden (week 9–10) · E8, E9 — **pilot-ready**

| ID | Task | Est | Story |
|---|---|---|---|
| S4-01 | Full-text search across incidents and actions | 1d | S8.1 |
| S4-02 | CSV/XLSX export, sync + async with email link | 1.5d | S8.2 |
| S4-03 | **Incident PDF pack** — report, evidence, RCA, CAPA, audit trail | 2.5d | S8.2 |
| S4-04 | Org-wide audit log viewer with filters and export | 1.5d | S9.1 |
| S4-05 | Offline PWA: service worker, IndexedDB queue, sync, idempotency | 3d | S2.2 |
| S4-06 | CSV importer for existing open actions | 1.5d | G14 |
| S4-07 | Performance pass: index review, N+1 elimination, p95 budgets | 1.5d | §17 |
| S4-08 | Security pass: headers, CSP, rate limits, upload sniffing, ASVS L2 checklist | 2d | §11 |
| S4-09 | Accessibility pass on reporting + dashboard (WCAG 2.1 AA) | 1d | §17 |
| S4-10 | i18n extraction (English only shipped) | 1d | §17 |
| S4-11 | Onboarding checklist + in-product help | 1d | — |
| S4-12 | Runbooks: restore, incident response, on-call | 1d | §11 |

**Exit gate — do not start a pilot until all of these are true:**
- [ ] Tenancy suite green; a manual cross-tenant attempt fails
- [ ] Restore from backup tested end to end this week
- [ ] p95 dashboard < 800 ms on 100k seeded incidents
- [ ] Report submitted and synced from a phone in genuine airplane mode
- [ ] Incident PDF pack reviewed by someone who has actually sat an ISO 45001 audit
- [ ] 5 Playwright journeys green in CI
- [ ] Sentry, uptime and queue-depth alerts firing to a real phone

## 7. Sprint 5 — Differentiate (week 11–12) · E10, E11, E12

Do these in the order the pilot asks for them. If the pilot is not signed, **stop and sell** —
[00 §5](00-SOURCE-ANALYSIS.md#5-brutal-truth-for-the-business-case).

| ID | Task | Est |
|---|---|---|
| S5-01 | AI service module: budget guard, logging, Zod-parsed output, graceful degradation | 1.5d |
| S5-02 | A1 summarize + A2 classify with the review badge | 1.5d |
| S5-03 | A3 5-Why prompts + A4 action suggestions | 1.5d |
| S5-04 | A6 duplicate detection at triage | 1d |
| S5-05 | A5 executive narrative in the weekly digest | 1d |
| S5-06 | AI feedback capture (accepted/edited/rejected) + a quality dashboard | 1d |
| S5-07 | WhatsApp webhook, signature verification, session state machine | 2d |
| S5-08 | WhatsApp guided reporting flow + templates | 2d |
| S5-09 | WhatsApp outbound assignment/overdue notifications | 1d |
| S5-10 | Plan limits enforcement (seats, sites, storage) + trial expiry to read-only | 1.5d |
| S5-11 | Payment provider interface + Stripe + one local rail | 2d |
| S5-12 | Billing admin page and invoices | 1d |

## 8. Post-MVP release plan

| Release | Contents | Trigger |
|---|---|---|
| **R2** (Q+1) | Risk register, inspections & audits with digital checklists, compliance obligations, Swahili UI, scheduled reports | 3+ paying customers |
| **R3** (Q+2) | Training & competency, contractor management, document control, permit to work | Enterprise deal requiring them |
| **R4** (Q+3) | Environmental module, occupational health with confidential access, native mobile | Sector demand |
| **R5** | SSO/SAML, API keys + marketplace, multi-country structures, data warehouse export, predictive analytics | First enterprise procurement |

Each of the 14 modules in the source catalogue maps onto the existing schema through
`taxonomy_terms`, the polymorphic attachment/comment tables, and the same
event → investigate → act loop. None requires re-architecture.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Field adoption fails — workers don't report | Fatal | Offline PWA, anonymous link, WhatsApp, <60 s form. Instrument `time_to_report` from day one and treat a flat median as a product emergency |
| WhatsApp approval slips | E11 late | Started in Sprint 0; E11 is a `Should`, never on the critical path |
| Scope creep from the 14-module catalogue | Miss the pilot window | The MVP scope list is a contract; new modules go to R2+ with no debate |
| Dashboard slows as data grows | Churn | Materialized views + partial indexes from the start; p95 budget in CI |
| Tenant data leak | Company-ending | Two independent layers + a CI-gated isolation suite |
| Single-engineer bus factor | Delivery stops | Every module follows the same shape; ADRs in `docs/`; no undocumented deploy step |
| Buyer demands in-country hosting | Deal blocked | Compose stack is portable to a customer VPC — priced as an Enterprise add-on |
| AI produces a wrong safety recommendation | Reputational, possibly legal | Human approval on every output, visible AI badge, full `ai_interactions` log |

## 10. Definition of Done

Per-ticket DoD: [02-BLUEPRINT §12](02-TECHNICAL-BLUEPRINT.md#12-definition-of-done-every-ticket).
Per-sprint: demoable on staging with seeded data, no known P1 bugs, CI green, docs updated.

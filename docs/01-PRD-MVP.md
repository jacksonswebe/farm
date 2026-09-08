# 01 — SafeSphere EHS: MVP Product Requirements Document

**Version** 1.0 · **Status** Ready for Sprint 0 · **Owner** Product/Founder
**Source** SafeSphere EHS Prospect & MVP Blueprint (10pp) · **Changes vs source**: [00-SOURCE-ANALYSIS](00-SOURCE-ANALYSIS.md)

---

## 1. Problem statement

Workplace safety processes fragment across paper forms, spreadsheets, email and WhatsApp.
The consequences are measurable and they are what we sell against:

| Symptom | Cost to the organization | MVP counter-measure |
|---|---|---|
| Events reported hours or days late, or not at all | Evidence decays; hazards recur | 60-second mobile report, offline-capable, anonymous option |
| Investigations done ad hoc | No consistent root-cause methodology | Guided investigation + 5 Whys workflow |
| Actions tracked in spreadsheets | Deadlines missed, ownership unclear | CAPA with owner, due date, automated chase, escalation |
| Actions closed without verification | Same incident repeats | Mandatory verification step by a second person |
| Management cannot see performance | Risk is invisible until it materialises | Live dashboard: open events, overdue actions, trends |
| Evidence not retrievable during audit | Findings, fines, lost contracts | Immutable audit trail + export in under 2 minutes |

## 2. Product goal for the MVP

Deliver the **safety accountability loop** — report → investigate → find cause → act → verify →
close → learn — for a single organization with multiple sites, to a standard where a real
company runs its live safety process on it, unsupported, for 90 days.

**Not** goals for the MVP: audits, permits, training, contractors, environmental, occupational
health, risk register, document control. Architecture leaves room; the code does not.

## 3. Success criteria (pilot exit gate)

The MVP is successful when, at a pilot customer, after 90 days:

| Metric | Baseline (typical) | MVP target |
|---|---|---|
| Median time from event to report submitted | > 24 h | < 4 h |
| Near-miss + hazard reports per 100 employees per month | < 2 | > 8 |
| Investigations completed within SLA | not measured | > 80 % |
| CAPA closed on or before due date | 40–60 % | > 75 % |
| Overdue action rate at any point in time | not measured | < 15 % |
| Time to retrieve full evidence pack for one incident | hours/days | < 2 min |
| Weekly active reporters / eligible workforce | n/a | > 25 % |
| Design partner willing to be a reference | — | Yes |

## 4. Personas

| Persona | Context | Primary need | Success looks like |
|---|---|---|---|
| **Amina — Employee / Reporter** | Site floor, Android phone, poor signal, low patience | Report what she just saw without friction or fear | Report submitted in <60 s, gets confirmation, sees it acted on |
| **Joseph — Supervisor / Site Manager** | Runs a site, is accountable for its numbers | See what happened on his site, close things out | Site view, his open actions, no surprises in the Monday meeting |
| **Grace — HSE/EHS Manager** *(primary user)* | Owns the safety system, 1–5 sites | Control the process, prove it works | Nothing overdue and unseen; audit evidence one click away |
| **Peter — Investigator** | Supervisor or engineer given an investigation | Structure, not a blank page | Guided flow, 5 Whys, submit for approval |
| **Fatma — Action Owner** | Maintenance/ops lead with a CAPA assigned | Know what is due, prove it is done | Reminder before due, upload photo, done |
| **Mr. Mwakalinga — Executive** *(economic buyer)* | Ops/Country Director, signs the contract | Confidence and defensibility | One dashboard, monthly summary, no nasty surprises |
| **Independent auditor** | On site 2 days, needs evidence | Retrieve records fast | Read-only access, filter, export |
| **System Administrator** | IT or the HSE manager | Set up org, users, taxonomies | Onboarding in under 1 hour |

## 5. MVP scope

### 5.1 In scope (`Must`)

| # | Epic | Outcome |
|---|---|---|
| E1 | Tenancy, auth & organization setup | An org exists with sites, departments, users, roles |
| E2 | Event reporting | Incidents, near misses, hazards, observations captured with evidence |
| E3 | Triage & classification | HSE reviews, classifies, assigns |
| E4 | Investigation & root cause | Guided investigation, findings, 5 Whys, approval |
| E5 | CAPA (corrective & preventive actions) | Actions with owners, due dates, evidence, verification |
| E6 | Notifications & escalation | The system chases people, not the HSE manager |
| E7 | Dashboards & analytics | Live operational and executive views |
| E8 | Search, filter & export | Find and extract anything, fast |
| E9 | Audit trail | Immutable record of who did what, when |

### 5.2 In scope (`Should` — ship if Sprint 5 allows)

| # | Epic | Outcome |
|---|---|---|
| E10 | AI assistance | Summaries, classification suggestions, 5-Why prompts, action suggestions — all human-approved |
| E11 | WhatsApp reporting | Guided report capture over WhatsApp Cloud API |
| E12 | Billing & plan limits | Self-serve subscription with enforced limits |

### 5.3 Explicitly out of scope for the MVP

Risk register · inspections/audits · compliance obligations register · training & competency ·
permit to work · contractor management · document control · emergency management · equipment
safety · occupational health · environmental module · native mobile apps · SSO/SAML ·
multi-language UI · SMS notifications · predictive analytics · document Q&A.

Everything above is accommodated by the data model and is scheduled in
[06-BUILD-PLAN §7](06-BUILD-PLAN.md#8-post-mvp-release-plan).

---

## 6. E1 — Tenancy, authentication & organization setup

### Stories

**S1.1 — Sign up and create an organization**
> As a prospective customer, I can create an account and an organization workspace so that my
> company's data is isolated from every other company's.

*Acceptance criteria*
- Given a valid email, password (min 10 chars, zxcvbn score ≥ 3) and organization name, when I
  submit, then an `organization` and a `user` are created, I am assigned the `ORG_ADMIN` role,
  and I land on the setup checklist.
- Email verification link is sent; unverified accounts may log in but cannot invite users.
- Organization slug is unique, lowercase, URL-safe, derived from the name with a numeric suffix on collision.
- A `trial` subscription is created with a 30-day expiry and the Professional feature set.
- Every subsequent write by this user carries `organization_id`; a request without a resolvable
  org context returns `403 ORG_CONTEXT_REQUIRED`.

**S1.2 — Invite users and assign roles**
> As an Org Admin, I can invite users by email and assign a role and site scope.

*Acceptance criteria*
- Invitation email contains a single-use token valid 7 days; accepting sets a password and activates membership.
- A user may hold exactly one role per organization (roles in [05-RBAC](05-RBAC-MATRIX.md)).
- A user may be scoped to `all sites` or to an explicit list of sites; scoping filters every list endpoint.
- Re-inviting an existing pending invite revokes the previous token.
- Deactivating a user preserves all their historical records and reassigns nothing automatically;
  open actions owned by a deactivated user are surfaced in a "needs reassignment" list.
- Plan seat limit is enforced at invite time (`402 PLAN_LIMIT_EXCEEDED`).

**S1.3 — Configure organization structure**
> As an Org Admin, I can create sites and departments so events can be located and filtered.

*Acceptance criteria*
- Site: name, code (unique per org), timezone (IANA), country, optional geolocation, active flag.
- Department: name, optional parent site, active flag.
- Sites/departments cannot be hard-deleted once referenced; they are deactivated and hidden from pickers.
- Every timestamp displayed for a record uses that record's site timezone; storage is UTC.

**S1.4 — Configure taxonomies**
> As an Org Admin, I can configure incident categories and severity labels so the system speaks
> my industry's language.

*Acceptance criteria*
- Seeded defaults exist for: report types, categories (12 defaults), injury types, body parts, root-cause categories.
- Admin may add/rename/deactivate categories; system defaults may be deactivated, not deleted.
- Severity scale (1–5) is fixed by the platform; only the display labels are editable.

**S1.5 — Secure authentication**
> As any user, my access is protected.

*Acceptance criteria*
- Argon2id password hashing; sessions are httpOnly, secure, sameSite=lax, 12 h idle / 30 d absolute expiry.
- Optional TOTP MFA, enforceable org-wide by the Org Admin.
- Rate limit: 5 failed logins per email per 15 min, then a 15-min lock; 20 requests/min/IP on auth routes.
- Password reset via single-use token, 1 h expiry, invalidating all existing sessions on use.

---

## 7. E2 — Event reporting

### 7.1 Report types

One form, four modes (`report_type`): `INCIDENT`, `NEAR_MISS`, `HAZARD`, `OBSERVATION`.
Rationale: [00-SOURCE-ANALYSIS D5](00-SOURCE-ANALYSIS.md#d5-one-incidents-table-for-incident--near-miss--hazard--observation).

### Stories

**S2.1 — Submit a report in under 60 seconds**
> As Amina, I can report what I saw from my phone in under a minute.

*Acceptance criteria*
- Required fields only: report type, what happened (free text ≥ 20 chars), site, date/time, severity.
  Everything else is optional and progressively disclosed.
- Date/time defaults to now, editable, cannot be in the future, cannot be > 90 days past.
- Location: site is required; department, specific area and GPS are optional. GPS is captured
  silently when permission already exists — it never blocks submission.
- Photos: up to 10 files, ≤ 15 MB each, image/* + video/mp4 + application/pdf. Client-side
  downscale of images to max 2048px before upload.
- On submit the report receives a reference number `INC-{YYYY}-{NNNN}` (per org, per year, gapless)
  and status `SUBMITTED`.
- The reporter sees a confirmation screen with the reference number and can screenshot it.
- p95 submit-to-confirmation ≤ 3 s on a 3G connection excluding attachment upload
  (attachments upload in the background and attach on completion).

**S2.2 — Report offline**
> As Amina working underground/on a remote site, I can complete a report with no connectivity
> and have it submit itself when signal returns.

*Acceptance criteria*
- The reporting form is a PWA route that loads from cache when offline.
- A submitted-while-offline report is stored in IndexedDB with its attachments and shows as "Pending sync".
- On reconnect, queued reports POST with a client-generated `idempotency_key`; duplicates are rejected
  server-side and resolved to the original record.
- The queued report retains its original `occurred_at`; `reported_at` is the server receipt time.
- The user sees a badge with the pending count and a manual "retry now" control.

**S2.3 — Capture the specifics that matter**
> As Grace, I need enough structured detail to classify and analyse.

*Acceptance criteria*
- Optional structured fields: category, sub-location/work area, immediate action taken,
  persons involved (named users or free-text names), witnesses (name + contact),
  injury details (injured person, injury type, body part, treatment level, lost-time flag),
  property/environmental damage description and estimated cost, equipment involved.
- Injury block is shown only when `report_type = INCIDENT` and "was anyone injured" is yes.
- `lost_time` and `reportable_to_authority` are boolean flags that drive dashboard counters.

**S2.4 — Save a draft**
- Reports may be saved as `DRAFT`, visible only to the author, editable, and excluded from all metrics.
- Drafts older than 30 days are flagged to the author, never auto-deleted.

**S2.5 — Anonymous reporting**
> As a worker who fears blame, I can report a hazard without identifying myself.

*Acceptance criteria*
- Each site exposes an optional public link/QR (`/r/{orgSlug}/{siteToken}`) requiring no login.
- Anonymous submissions are rate-limited (10/hour/IP), captcha-gated after 3, and land as
  `report_type` ∈ {HAZARD, NEAR_MISS, OBSERVATION} only — never as a full incident.
- `reported_by_user_id` is null; `is_anonymous = true`; an optional contact field is stored
  encrypted and visible only to the HSE Manager role.
- Org Admin can disable anonymous reporting per site.

**S2.6 — Edit and withdraw**
- The author may edit a `SUBMITTED` report for 30 minutes; after that only HSE roles may edit,
  and every field change writes an audit event with before/after values.
- HSE may mark a report `REJECTED` (with mandatory reason) or `DUPLICATE` (linked to the original).
  Neither is deletion — records are never destroyed.

---

## 8. E3 — Triage & classification

**S3.1 — Triage queue**
> As Grace, I see every new report in one queue and dispose of it quickly.

*Acceptance criteria*
- Queue lists `SUBMITTED` reports sorted by severity desc, then age desc, with site/type/severity filters.
- Bulk actions: acknowledge, assign, set severity.
- Every report shows time-since-submission with an SLA colour: green < 4 h, amber 4–24 h, red > 24 h (configurable per severity).

**S3.2 — Classify**
- HSE sets/confirms: severity (1–5), likelihood of recurrence (1–5), category, whether an
  investigation is required, and whether it is reportable to an authority.
- Risk score = severity × likelihood, banded: 1–4 Low, 5–9 Medium, 10–14 High, 15–25 Critical.
- Setting severity ≥ 4 or `lost_time = true` **forces** `investigation_required = true`.

**S3.3 — Route without investigation**
- Low-severity hazards/observations may skip investigation: HSE assigns a direct corrective action
  and the report moves to `ACTIONS_PENDING`.

**S3.4 — Acknowledge to the reporter**
- On acknowledgement the reporter receives a notification; anonymous reports skip this.
- `acknowledged_at` is recorded and feeds the "time to acknowledge" metric.

### 7.3 Severity scale (platform-fixed)

| # | Key | Default label | Guide |
|---|---|---|---|
| 1 | `NEGLIGIBLE` | Negligible | No injury; negligible loss |
| 2 | `MINOR` | Minor | First aid only; minor damage |
| 3 | `MODERATE` | Moderate | Medical treatment; restricted work; moderate loss |
| 4 | `MAJOR` | Major | Lost-time injury; significant damage or environmental release |
| 5 | `CATASTROPHIC` | Catastrophic | Fatality, permanent disability, major loss |

---

## 9. E4 — Investigation & root cause

**S4.1 — Assign an investigator**
- HSE assigns one lead investigator (+ optional team members) and a due date (default: 7 days,
  configurable per severity band).
- Assignment notifies the investigator; the report moves to `INVESTIGATING`.

**S4.2 — Conduct the investigation**
*Acceptance criteria*
- Sections: sequence of events (timeline entries with time + description), evidence
  (files, photos, documents), interviews (person, date, notes), immediate/underlying findings,
  contributing factors.
- The investigator can request more information from the reporter (notification + a comment thread).
- Autosave every 20 s; no work is lost on connection failure.

**S4.3 — 5 Whys root cause analysis**
*Acceptance criteria*
- A guided sequence of at least 3 and up to 7 "why" steps, each with a statement and optional evidence link.
- The final why is designated the root cause and must be assigned a root-cause **category**
  (People / Process / Equipment / Environment / Management System / External).
- More than one root-cause chain may be recorded per investigation.
- Guardrail: the UI warns when a root cause names an individual person rather than a system
  failure ("blame detected — consider the system condition that allowed this").

**S4.4 — Findings and recommendations**
- Findings are typed (`IMMEDIATE_CAUSE`, `UNDERLYING_CAUSE`, `ROOT_CAUSE`, `OBSERVATION`) and
  each may spawn one or more CAPA actions directly.
- An investigation cannot be submitted with zero findings.

**S4.5 — Submit and approve**
- The investigator submits; the HSE Manager approves or returns it with mandatory comments.
- Approval requires at least one root cause and at least one action (corrective or preventive).
- On approval the report moves to `ACTIONS_PENDING`; `investigation_completed_at` is stamped.

---

## 10. E5 — CAPA

**S5.1 — Create actions**
*Acceptance criteria*
- An action has: title, description, type (`CORRECTIVE` | `PREVENTIVE`), hierarchy-of-control
  level (Elimination / Substitution / Engineering / Administrative / PPE), owner (a user),
  optional verifier, due date, priority, source link (incident, finding, or standalone).
- Due date is mandatory and must be in the future at creation.
- Hierarchy-of-control level is mandatory — it is the single field that distinguishes a real
  safety system from a task list, and it feeds the "quality of controls" dashboard tile.
- Actions may be created from a finding, from a report directly, or standalone by HSE.

**S5.2 — Work an action**
- The owner sees assigned actions on a personal "My Actions" view sorted by due date.
- Owner may add progress notes, upload evidence files, and set `IN_PROGRESS`.
- Owner may request a due-date extension with a reason; HSE approves or rejects; every extension
  is recorded and the original due date is retained for metrics.

**S5.3 — Verify and close**
*Acceptance criteria*
- Owner submits for verification (status `PENDING_VERIFICATION`) — evidence is mandatory when
  the action came from a severity ≥ 3 event.
- The verifier (never the owner — enforced server-side) marks `VERIFIED_CLOSED` or returns it to
  `IN_PROGRESS` with mandatory comments.
- Verification records: verifier, date, effectiveness rating (Effective / Partially effective /
  Not effective) and comments.
- "Not effective" automatically creates a linked follow-up action pre-filled from the original.

**S5.4 — Close the event**
- A report may be closed only when all linked actions are `VERIFIED_CLOSED` or `CANCELLED`.
- Closure requires an HSE role, a closure statement, and stamps `closed_at`.
- Closed reports are read-only except for HSE-added lessons-learned notes.

**S5.5 — Overdue handling**
- An action past its due date with status ∉ {VERIFIED_CLOSED, CANCELLED} is `overdue`
  (a derived flag, not a stored status).
- Overdue actions appear in a dedicated dashboard tile, in the owner's view, and in the
  supervisor's site view.

---

## 11. E6 — Notifications & escalation

### 11.1 Notification matrix

| Trigger | Recipient | Channels | Default timing |
|---|---|---|---|
| Report submitted (severity 1–2) | HSE Managers of the site | In-app, email digest | Hourly digest |
| Report submitted (severity 3) | HSE Managers of the site | In-app, email | Immediate |
| Report submitted (severity 4–5) | HSE Managers + Site Manager + configured escalation list | In-app, email, WhatsApp | Immediate |
| Report acknowledged | Reporter | In-app, email | Immediate |
| Investigation assigned | Investigator | In-app, email | Immediate |
| Investigation due in 2 days / overdue | Investigator, then HSE | In-app, email | 09:00 site-local |
| Investigation submitted | HSE Manager | In-app, email | Immediate |
| Investigation returned | Investigator | In-app, email | Immediate |
| Action assigned | Owner | In-app, email, WhatsApp (opt-in) | Immediate |
| Action due reminder | Owner | In-app, email | T−7d, T−3d, T−1d @09:00 local |
| Action overdue | Owner | In-app, email | T+1d, then every 3 d |
| Action overdue ≥ 7 d | Owner's supervisor + HSE | In-app, email | Once, then weekly |
| Action overdue ≥ 21 d | Executive recipients | Email | Weekly |
| Action submitted for verification | Verifier | In-app, email | Immediate |
| Weekly summary | HSE, Site Managers, Executives | Email | Monday 08:00 site-local |

### Stories

**S6.1** All timings, channel choices and escalation thresholds above are configurable per
organization; the table is the default seed. Config lives in `notification_rules`.

**S6.2** Every user has a notification preference page: per-category channel opt-in/out.
Escalation and assignment notifications cannot be fully disabled — only redirected to digest.

**S6.3** Quiet hours: no non-critical notification is sent outside 07:00–19:00 site-local;
severity 4–5 alerts ignore quiet hours.

**S6.4** Delivery is recorded per notification (`queued/sent/delivered/failed`) with the provider
message id, and failures retry 3× with exponential backoff before being marked failed and
surfaced to the Org Admin.

**S6.5** Digest emails group by category and never exceed one email per recipient per hour.

---

## 12. E7 — Dashboards & analytics

### 12.1 HSE operational dashboard (default landing for HSE roles)

Tiles, all filterable by date range, site, department, report type and severity:

1. Events this period vs previous (count + % change), split by report type
2. Open events by status (funnel: submitted → investigating → actions pending → closed)
3. Overdue actions (count + list, click-through)
4. Actions due in the next 7 days
5. Investigations overdue
6. Severity distribution (stacked bar by month)
7. Events by site / department (bar, sorted desc)
8. Top 5 recurring root-cause categories (bar)
9. Leading vs lagging indicator ratio (near-miss + hazard + observation) ÷ incidents
10. Median time to report / to acknowledge / to investigate / to close (4 stat tiles with trend)
11. Action closure rate by responsible team
12. Hierarchy-of-control mix of the last 50 actions (are we fixing systems or issuing PPE?)

### 12.2 Executive view (read-only)

Fewer tiles, longer horizon: 12-month trend of incidents and LTI, overdue action rate,
site league table, closure rate, participation rate, and a one-paragraph AI-drafted narrative
(E10) that a human can edit before it is emailed.

### 12.3 Site/supervisor view

Scoped automatically to the user's sites: my site's open events, my site's overdue actions,
my team's actions, and the site's 30-day trend.

### 12.4 Requirements

- All dashboard queries must return in < 800 ms p95 at 100k incidents / 500k actions per tenant.
- Every tile is click-through to a filtered list — no dead ends.
- Numbers are computed from a nightly-refreshed materialized view for trend tiles and live SQL
  for the "current state" tiles (overdue, open) so operational numbers are never stale.
- Empty states explain what to do, not "no data".

---

## 13. E8 / E9 — Search, export & audit trail

**S8.1 — Search**
- Full-text search across report title, description, reference number, and action title/description
  using Postgres `tsvector`, scoped to org and the user's site scope.
- Filters: type, status, severity, site, department, category, date range, assignee, overdue flag.
- Filter state is URL-encoded so a view can be shared or bookmarked.

**S8.2 — Export**
- Any filtered list exports to CSV and XLSX (≤ 50k rows synchronously; larger goes to a background
  job and an email link).
- A single incident exports to PDF including: report, attachments index, investigation, 5 Whys,
  findings, all actions with evidence, verification records and the full audit trail.
  **This is the audit artifact — it is the feature that sells the product.**
- Exports are themselves audit events (who exported what, when).

**S9.1 — Audit trail**
- Every create/update/delete/status-change/assignment/export/login writes an `audit_events` row:
  actor, org, entity type, entity id, action, before/after diff (JSONB), IP, user agent, timestamp.
- Audit rows are append-only: no UPDATE or DELETE grant on the table for the application role.
- Viewable per record ("History" tab) and org-wide by Org Admin/Auditor with filters and export.
- Retention: minimum 7 years, configurable up, never down below 7 without an explicit
  contractual override flag.

---

## 14. E10 — AI assistance (Should)

Design rule: **AI drafts, humans decide.** No AI output is ever persisted as a final record
without an explicit human save action, and every AI interaction is logged.

| # | Capability | Input | Output | Human gate |
|---|---|---|---|---|
| A1 | Report summarization | Full report text + structured fields | 3–5 sentence investigation-ready summary | Editable text box, must be saved |
| A2 | Classification assist | Description | Suggested category, severity, likelihood + confidence + one-line reason | Pre-fills form fields, user confirms |
| A3 | 5-Why prompts | Facts recorded so far | 3 candidate next "why" questions | Suggestion chips; user writes the answer |
| A4 | Action suggestions | Root cause + context | 3–5 candidate actions with hierarchy-of-control level | User selects, edits, assigns |
| A5 | Executive narrative | Aggregated dashboard figures (no free text, no names) | One-paragraph summary for the weekly email | HSE edits before send |
| A6 | Duplicate detection | New report vs last 90 days | Possible duplicates with similarity score | HSE decides |

*Acceptance criteria*
- Every AI call writes an `ai_interactions` row: org, user, feature, model, prompt hash, token
  counts, latency, cost, accepted/rejected/edited.
- AI features are org-level toggles, default **on** for trial, with a one-click org-wide off.
- No personally identifying free text leaves the tenant boundary for A5 (aggregates only).
- A visible "AI-assisted — review before saving" badge on every generated field.
- Failure of the AI provider never blocks the underlying workflow; the feature degrades silently
  to manual entry.
- Per-org monthly AI spend cap with a soft warning at 80 % and a hard stop at 100 %.

## 15. E11 — WhatsApp reporting (Should)

- Inbound message to the org's WhatsApp number starts a guided flow: identify (phone → user, or
  anonymous), pick report type, describe, optional photo, pick site, confirm.
- The conversation state machine lives server-side keyed by phone number, expiring after 30 min idle.
- On completion, a normal report is created with `source = WHATSAPP` and the reference number is
  returned in the chat.
- Outbound: action assignment and overdue notifications via approved message templates.
- Meta Business verification and template approval must start in **Sprint 1** — it is a
  multi-week external dependency, not a coding task.

## 16. E12 — Billing (Should)

See [07-COMMERCIAL-MODEL](07-COMMERCIAL-MODEL.md). Requirement in the MVP: plan record per org,
enforced seat and site limits, trial expiry with a read-only grace period (never data deletion),
and a payment link. Full self-serve checkout may slip to Release 2 if a sales-led motion is used.

---

## 17. Non-functional requirements

| Area | Requirement |
|---|---|
| **Performance** | p95 API < 400 ms; p95 dashboard < 800 ms; report submit < 3 s on 3G; first contentful paint < 2 s on a mid-range Android |
| **Availability** | 99.5 % monthly for the MVP (≈3.6 h/month); planned maintenance announced 48 h ahead |
| **Scale target** | 50 tenants; largest tenant 2,000 users, 20 sites, 100k incidents, 500k actions |
| **Mobile** | Fully responsive; reporting + my-actions are PWA-installable and offline-capable |
| **Browsers** | Chrome/Android WebView last 2 versions, Safari iOS 16+, Edge/Firefox current |
| **Accessibility** | WCAG 2.1 AA on the reporting flow and dashboards; keyboard-navigable; ≥ 4.5:1 contrast |
| **Localisation** | All copy through an i18n layer from day one (English only at launch; Swahili second) |
| **Data residency** | Single region at MVP; architecture must permit per-tenant region pinning later |
| **Backups** | Nightly full + 15-min WAL archiving; monthly restore test; RPO 15 min, RTO 4 h |
| **Security** | See [02-BLUEPRINT §11](02-TECHNICAL-BLUEPRINT.md#11-security); OWASP ASVS L2 as the target |
| **Privacy** | Injury and health data flagged `sensitive`; visible only to HSE roles + the subject; excluded from exports unless explicitly included by a permitted role |
| **Retention** | Records retained for the org's configured period (default 7 years); tenant deletion is a 30-day soft delete then irreversible purge with a certificate |
| **Observability** | Structured JSON logs with request id + org id, error tracking, uptime checks, job-queue depth alerts |

---

## 18. Instrumentation — the event taxonomy

Emit these product events from day one; the pilot exit gate in §3 cannot be measured without them.

`user.signed_up` · `org.created` · `user.invited` · `user.activated` · `site.created`
`report.started` · `report.submitted` (props: type, severity, source, offline_queued, seconds_to_complete)
`report.acknowledged` · `report.classified` · `report.rejected`
`investigation.assigned` · `investigation.submitted` · `investigation.approved` · `investigation.returned`
`rootcause.recorded` (props: category, why_depth)
`action.created` (props: type, hierarchy_level) · `action.started` · `action.evidence_uploaded`
`action.submitted_for_verification` · `action.verified` (props: effectiveness, days_late)
`action.overdue_triggered` · `action.escalated` (props: level)
`incident.closed` (props: days_open)
`dashboard.viewed` · `export.generated` (props: format, scope) · `search.performed`
`ai.suggestion_shown` · `ai.suggestion_accepted` · `ai.suggestion_edited` · `ai.suggestion_rejected`
`notification.sent` / `.failed` (props: channel, category)
`whatsapp.session_started` · `whatsapp.report_completed`

Derived metrics: `time_to_report`, `time_to_acknowledge`, `time_to_investigate`,
`time_to_close`, `action_closure_rate`, `overdue_rate`, `leading_lagging_ratio`,
`participation_rate`, `repeat_root_cause_rate`, `audit_retrieval_time`.

---

## 19. Assumptions & open questions

**Assumptions taken (proceeding on these unless corrected)**
1. Design partner is a Tanzanian or East African mid-size operation (construction, mining or
   agro-processing) with 200–2,000 workers and an existing HSE function.
2. English-first is acceptable at launch; Swahili is a Release-2 requirement, not a launch blocker.
3. Buyers accept cloud hosting outside their country at MVP, with on-prem/regional as an enterprise option.
4. WhatsApp is the dominant field communication channel; SMS is not required.
5. A 30-day free trial, not a freemium tier, is the acquisition motion.

**Open questions requiring a decision before the sprint they affect**
| # | Question | Needed by |
|---|---|---|
| Q1 | Who is the signed design partner, and which site pilots first? | Sprint 2 |
| Q2 | Do any target customers contractually require in-country data residency? | Sprint 4 (hosting choice) |
| Q3 | Is a regulator-reportable incident export format required (national OSH authority form)? | Sprint 5 |
| Q4 | Local payment rails: M-Pesa/Selcom/ClickPesa vs card-only via Stripe? | Sprint 5 (E12) |
| Q5 | Does the pilot customer need Swahili at launch after all? | Sprint 3 |

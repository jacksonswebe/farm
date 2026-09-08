# 04 — API Specification

Machine-readable contract: [`api/openapi.yaml`](../api/openapi.yaml) (OpenAPI 3.1).
This document covers the conventions that the YAML cannot express.

Base path `/api/v1`. JSON only. All timestamps ISO 8601 UTC.

---

## 1. Conventions

### Authentication
Session cookie (`safesphere.sid`, httpOnly/secure/sameSite=lax) for the web app.
`Authorization: Bearer <token>` with a scoped API key for integrations (Release 2).
The active organization comes from the session; `X-Organization-Id` may override it for users who
belong to several orgs and must match a live membership.

### Request/response envelope

```jsonc
// single resource
{ "data": { … } }

// collection
{ "data": [ … ], "meta": { "nextCursor": "eyJjIjoi…", "hasMore": true, "total": 1284 } }

// error
{ "error": { "code": "VALIDATION_ERROR", "message": "…",
             "details": [ { "path": "occurredAt", "message": "must not be in the future" } ],
             "requestId": "req_01J…" } }
```

`total` is present only when the filtered count is under 10,000; beyond that it is omitted rather
than paid for on every page.

### Pagination
Keyset only: `?cursor=<opaque>&limit=25` (max 100), ordered `created_at DESC, id DESC`.
Offset pagination is not offered — it degrades and it double-counts under concurrent writes.

### Filtering and sorting
`?site=<uuid>&type=INCIDENT&status=SUBMITTED,ACKNOWLEDGED&severity=MAJOR,CATASTROPHIC`
`&from=2026-01-01&to=2026-03-31&q=scaffold&overdue=true&sort=-occurredAt`
Repeated values are comma-separated. Unknown parameters are a `400`, never ignored — a silently
dropped filter in a safety report is a wrong answer presented as a right one.

### Idempotency
`POST` accepts `Idempotency-Key` (required for offline-queued submissions). The key is stored per
org; a replay returns the original resource with `200` and `Idempotency-Replayed: true`.

### Rate limits
Per [02-BLUEPRINT §11](02-TECHNICAL-BLUEPRINT.md#11-security). Responses carry `RateLimit-Limit`,
`RateLimit-Remaining`, `RateLimit-Reset`; exceeding returns `429` with `Retry-After`.

### Error codes

| HTTP | code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod rejected the body or query |
| 401 | `UNAUTHENTICATED` | No or expired session |
| 403 | `PERMISSION_DENIED` | Role lacks the permission key |
| 403 | `OUT_OF_SCOPE` | Record outside the user's site scope |
| 403 | `ORG_CONTEXT_REQUIRED` | No resolvable organization |
| 404 | `NOT_FOUND` | Absent, or present in another tenant (indistinguishable by design) |
| 409 | `INVALID_STATE` | Transition not allowed from the current status |
| 409 | `OWNER_CANNOT_VERIFY` | Verifier is the action owner |
| 402 | `PLAN_LIMIT_EXCEEDED` | Seat, site or storage limit hit |
| 413 | `FILE_TOO_LARGE` | Upload exceeds the cap |
| 422 | `BUSINESS_RULE_VIOLATION` | e.g. closing an incident with open actions |
| 429 | `RATE_LIMITED` | Throttled |
| 500 | `INTERNAL_ERROR` | Logged with `requestId`; never leaks internals |

A record in another tenant returns `404`, not `403` — a `403` confirms the record exists.

---

## 2. Endpoints

### Auth & session
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | Creates user + organization + trial subscription |
| POST | `/auth/login` | public | Rate limited; returns session cookie |
| POST | `/auth/logout` | auth | |
| POST | `/auth/verify-email` | public | Single-use token |
| POST | `/auth/forgot-password` · `/auth/reset-password` | public | Always `200`, never reveals existence |
| POST | `/auth/mfa/enroll` · `/auth/mfa/verify` · `/auth/mfa/disable` | auth | TOTP + recovery codes |
| GET | `/me` | auth | User, memberships, active org, permissions, site scope |
| PATCH | `/me` | auth | Profile, locale, notification preferences |

### Organization
| Method | Path | Permission |
|---|---|---|
| GET · PATCH | `/organization` | `org.settings.manage` (PATCH) |
| GET · POST | `/organization/sites` | `org.sites.manage` |
| GET · PATCH | `/organization/sites/{id}` | `org.sites.manage` |
| POST | `/organization/sites/{id}/anonymous-link` | `org.sites.manage` — rotates the public token |
| GET · POST · PATCH | `/organization/departments[/{id}]` | `org.sites.manage` |
| GET · POST · PATCH | `/organization/taxonomy[/{id}]` | `org.taxonomy.manage` |
| GET · POST | `/organization/members` · `/organization/invitations` | `org.users.manage` |
| PATCH · DELETE | `/organization/members/{id}` | `org.users.manage` — DELETE deactivates, never destroys |
| GET · PUT | `/organization/notification-rules` | `org.notifications.configure` |

### Incidents
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/incidents` | `incident.view` | Filter, search, keyset paginate |
| POST | `/incidents` | `incident.create` | `Idempotency-Key` supported |
| GET | `/incidents/{id}` | `incident.view` | Sensitive fields stripped without `view_sensitive` |
| PATCH | `/incidents/{id}` | `incident.edit` | Field diff → audit event |
| POST | `/incidents/{id}/submit` | author | DRAFT → SUBMITTED |
| POST | `/incidents/{id}/acknowledge` | `incident.acknowledge` | |
| POST | `/incidents/{id}/classify` | `incident.classify` | severity, likelihood, category, investigation_required |
| POST | `/incidents/{id}/reject` | `incident.reject` | `reason` required |
| POST | `/incidents/{id}/duplicate` | `incident.mark_duplicate` | `duplicateOfId` required |
| POST | `/incidents/{id}/close` | `incident.close` | `422` if any action is open |
| GET · POST | `/incidents/{id}/persons` | `incident.edit` | Involved / injured / witness |
| GET · POST | `/incidents/{id}/comments` | `incident.view` | |
| GET | `/incidents/{id}/audit` | `audit.view` | |
| GET | `/incidents/{id}/export` | `report.export` | `?format=pdf\|csv` — the audit artifact |
| POST | `/public/reports` | none (site token) | Anonymous submission; captcha after 3/hour/IP |

### Investigations
| Method | Path | Permission |
|---|---|---|
| POST | `/incidents/{id}/investigation` | `investigation.assign` |
| GET · PATCH | `/investigations/{id}` | `investigation.conduct` |
| POST | `/investigations/{id}/submit` | `investigation.conduct` — guard: ≥1 finding, ≥1 root cause, ≥1 action |
| POST | `/investigations/{id}/approve` · `/return` | `investigation.approve` — return needs comments |
| GET · POST · PATCH · DELETE | `/investigations/{id}/timeline[/{eid}]` | `investigation.conduct` |
| GET · POST | `/investigations/{id}/interviews` | `investigation.conduct` |
| GET · POST · PATCH | `/investigations/{id}/findings[/{fid}]` | `investigation.conduct` |
| GET · POST | `/investigations/{id}/root-causes` | `investigation.conduct` |
| PUT | `/root-causes/{id}/whys` | `investigation.conduct` — replaces the 1–7 step chain atomically |

### Actions (CAPA)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/actions` | `action.view` | `?owner=me&overdue=true&dueBefore=…` |
| GET | `/actions/mine` | auth | Owner view, sorted by due date |
| GET | `/actions/awaiting-verification` | `action.verify` | |
| POST | `/actions` | `action.create` | From a finding, an incident, or standalone |
| GET · PATCH | `/actions/{id}` | `action.view` / `action.update_progress` | |
| POST | `/actions/{id}/start` | owner | OPEN → IN_PROGRESS |
| POST | `/actions/{id}/updates` | owner | Progress note + percent |
| POST | `/actions/{id}/submit` | owner | → PENDING_VERIFICATION; evidence required when source severity ≥ MODERATE |
| POST | `/actions/{id}/verify` | `action.verify` | `effectiveness` required; `409 OWNER_CANNOT_VERIFY` |
| POST | `/actions/{id}/reject` | `action.verify` | Comments required; → IN_PROGRESS |
| POST | `/actions/{id}/cancel` | `action.cancel` | Reason required |
| POST | `/actions/{id}/extensions` | owner | Request a new due date + reason |
| POST | `/actions/{id}/extensions/{eid}/decide` | `action.approve_extension` | approve/reject |
| POST | `/actions/{id}/reassign` | `action.reassign` | |

### Attachments
| Method | Path | Notes |
|---|---|---|
| POST | `/attachments/presign` | Returns `{ attachmentId, uploadUrl, expiresAt }`, 5-min PUT |
| POST | `/attachments/{id}/complete` | Server HEADs the object, verifies size/type, marks UPLOADED |
| GET | `/attachments/{id}/url` | Presigned GET, 15-min expiry, permission-checked |
| DELETE | `/attachments/{id}` | Soft delete; object purged by the nightly job |

### Dashboard & analytics
| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard/summary` | All current-state tiles in one call — live SQL |
| GET | `/dashboard/trends` | Time series from the materialized views; `?metric=&groupBy=&interval=` |
| GET | `/dashboard/leaderboard` | Site/department comparison |
| GET | `/analytics/root-causes` | Recurring root-cause categories |
| GET | `/analytics/performance` | Median times, closure rate, overdue rate |

One `summary` call, not twelve — the dashboard is the most-loaded page in the product.

### Notifications, exports, AI, search
| Method | Path | Notes |
|---|---|---|
| GET | `/notifications` · POST `/notifications/read` | In-app inbox |
| POST | `/exports` · GET `/exports/{id}` | Async for large sets; returns a presigned link when READY |
| GET | `/search?q=` | Cross-entity full-text, org- and scope-limited |
| POST | `/ai/summarize` · `/ai/classify` · `/ai/why-suggestions` · `/ai/action-suggestions` | `ai.use`; logs an `ai_interactions` row; returns `null` data on provider failure, never a 5xx |
| POST | `/ai/feedback` | Records ACCEPTED / EDITED / REJECTED against the interaction |

### Webhooks (inbound)
| Path | Verification |
|---|---|
| `/api/webhooks/whatsapp` | `X-Hub-Signature-256` HMAC; `GET` handles Meta's verify challenge |
| `/api/webhooks/payments` | Provider signature; idempotent on the provider event id |
| `/api/health` | Liveness + DB + queue depth; used by the deploy gate |

---

## 3. Worked example — the demo loop

```http
POST /api/v1/incidents
Idempotency-Key: 8f14e45f-ea0d-4b1e-9c6a-0e0b7a3d51aa
{ "reportType":"INCIDENT", "description":"Steel fixer fell 2.4 m from an unguarded scaffold edge…",
  "siteId":"2222…01", "departmentId":"2222…301", "workArea":"Block C — slab edge, level 2",
  "occurredAt":"2026-08-12T07:15:00Z", "immediateAction":"Area barricaded, work at height stopped.",
  "attachmentIds":["…"] }

201 → { "data": { "id":"4444…01", "reference":"INC-2026-0001", "status":"SUBMITTED" } }

POST /api/v1/incidents/4444…01/acknowledge          → ACKNOWLEDGED
POST /api/v1/incidents/4444…01/classify
     { "severity":"MAJOR","likelihood":"POSSIBLE","categoryTermId":"…","investigationRequired":true }
     → riskScore 12, riskBand "HIGH" (derived server-side)
POST /api/v1/incidents/4444…01/investigation
     { "leadInvestigatorId":"3333…03","dueAt":"2026-08-19T15:00:00Z" }   → INVESTIGATING
PUT  /api/v1/root-causes/6666…01/whys                → the 5-step chain
POST /api/v1/investigations/5555…01/submit           → SUBMITTED
POST /api/v1/investigations/5555…01/approve          → APPROVED, incident → ACTIONS_PENDING
POST /api/v1/actions
     { "title":"Install continuous horizontal lifeline…", "actionType":"CORRECTIVE",
       "hierarchyLevel":"ENGINEERING", "ownerUserId":"3333…05", "dueDate":"2026-08-30" }
POST /api/v1/actions/{id}/submit                     → PENDING_VERIFICATION
POST /api/v1/actions/{id}/verify { "effectiveness":"EFFECTIVE", … }  → VERIFIED_CLOSED
POST /api/v1/incidents/4444…01/close { "closureStatement":"…" }      → CLOSED
GET  /api/v1/incidents/4444…01/export?format=pdf     → the audit artifact
```

Every step above writes an `audit_events` row and emits a product event.

## 4. Versioning

`/api/v1` is stable once a customer integrates. Additive changes (new optional fields, new
endpoints) ship in `v1`. Breaking changes open `/api/v2` with `v1` supported for 12 months and a
`Deprecation` header on every `v1` response during the overlap.

# 05 — Roles, Permissions & Authorization

Eight roles, from the source proposal §8. One role per user per organization.

---

## 1. Roles

| Role | Who | Site scope | Notes |
|---|---|---|---|
| `ORG_ADMIN` | IT or the HSE lead | All | Configuration and users. Not automatically a safety approver. |
| `HSE_MANAGER` | Grace — primary user | All (usually) | Owns the safety workflow end to end |
| `INVESTIGATOR` | Safety officer, engineer | Assigned | Works investigations assigned to them |
| `SITE_MANAGER` | Joseph — site lead | Their sites | Operational accountability for their sites |
| `ACTION_OWNER` | Fatma — supervisor | Their sites | Executes CAPA; can report |
| `EMPLOYEE` | Amina — worker | Their sites | Reports; sees only their own submissions and actions |
| `EXECUTIVE` | Country/Ops Director | All | Read-only dashboards and reports |
| `AUDITOR` | Internal or external auditor | All or specified | Read-only records, evidence and audit trail; time-boxed access |

## 2. Permission matrix

`✓` full · `own` own records only · `site` within site scope · `assigned` only where assigned ·
`–` denied · `R` read only

| Permission key | ORG_ADMIN | HSE_MANAGER | INVESTIGATOR | SITE_MANAGER | ACTION_OWNER | EMPLOYEE | EXECUTIVE | AUDITOR |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Organization** |
| `org.settings.manage` | ✓ | – | – | – | – | – | – | – |
| `org.users.manage` | ✓ | – | – | – | – | – | – | – |
| `org.sites.manage` | ✓ | – | – | – | – | – | – | – |
| `org.taxonomy.manage` | ✓ | ✓ | – | – | – | – | – | – |
| `org.notifications.configure` | ✓ | ✓ | – | – | – | – | – | – |
| `org.billing.manage` | ✓ | – | – | – | – | – | – | – |
| **Reports** |
| `incident.create` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `incident.view` | ✓ | ✓ | site | site | site | own | R | R |
| `incident.view_sensitive` (injury/health) | – | ✓ | assigned | – | – | own | – | – |
| `incident.edit` | – | ✓ | assigned | site¹ | own¹ | own¹ | – | – |
| `incident.classify` | – | ✓ | – | site | – | – | – | – |
| `incident.acknowledge` | – | ✓ | – | site | – | – | – | – |
| `incident.reject` / `.mark_duplicate` | – | ✓ | – | – | – | – | – | – |
| `incident.close` | – | ✓ | – | – | – | – | – | – |
| **Investigations** |
| `investigation.assign` | – | ✓ | – | site | – | – | – | – |
| `investigation.conduct` | – | ✓ | assigned | – | – | – | – | – |
| `investigation.view` | ✓R | ✓ | assigned | site | – | – | R | R |
| `investigation.approve` | – | ✓ | – | – | – | – | – | – |
| **Actions (CAPA)** |
| `action.create` | – | ✓ | assigned | site | – | – | – | – |
| `action.view` | ✓R | ✓ | assigned | site | own | own | R | R |
| `action.update_progress` | – | ✓ | assigned | site | own | own | – | – |
| `action.submit_for_verification` | – | ✓ | assigned | site | own | own | – | – |
| `action.verify` | – | ✓ | – | site² | – | – | – | – |
| `action.reassign` | – | ✓ | – | site | – | – | – | – |
| `action.approve_extension` | – | ✓ | – | site | – | – | – | – |
| `action.cancel` | – | ✓ | – | – | – | – | – | – |
| **Data** |
| `dashboard.view` | ✓ | ✓ | site | site | own | own | ✓ | ✓ |
| `report.export` | ✓ | ✓ | assigned | site | – | – | ✓ | ✓ |
| `audit.view` | ✓ | ✓ | – | site | – | – | – | ✓ |
| `attachment.upload` | ✓ | ✓ | assigned | site | own | own | – | – |
| `attachment.delete` | – | ✓ | – | – | own³ | own³ | – | – |
| **AI** |
| `ai.use` | ✓ | ✓ | ✓ | ✓ | – | – | – | – |
| `ai.configure` | ✓ | ✓ | – | – | – | – | – | – |

¹ Author may edit for 30 minutes after submission; after that only HSE.
² A Site Manager may verify actions on their site **unless** they are the owner — the
`actions_owner_is_not_verifier` DB constraint and the service policy both block it.
³ Only their own uploads, only while the parent record is not closed.

**Deliberate constraint:** `ORG_ADMIN` cannot read `incident.view_sensitive`. IT administers the
system; it does not read employees' injury records. Any org that needs both grants the person an
`HSE_MANAGER` membership as well.

## 3. Enforcement — three independent layers

```
1. Middleware      authenticated? active membership? org resolved?  → 401 / 403
2. Route handler   requirePermission(ctx, 'action.verify')          → 403 PERMISSION_DENIED
3. Service policy  policy.canVerify(ctx, action)                     → 403 with a reason
   + Postgres      RLS + CHECK constraints                           → the last line
```

Every module ships a `policy.ts`:

```ts
// src/server/modules/actions/policy.ts
export const actionPolicy = {
  canVerify(ctx: Ctx, action: Action): Result {
    if (!hasPermission(ctx.role, 'action.verify')) return deny('PERMISSION_DENIED');
    if (action.ownerUserId === ctx.userId)         return deny('OWNER_CANNOT_VERIFY');
    if (action.status !== 'PENDING_VERIFICATION')  return deny('INVALID_STATE');
    if (!inSiteScope(ctx, action.siteId))          return deny('OUT_OF_SCOPE');
    return allow();
  },
};
```

**Rule:** no route handler makes an authorization decision inline. Every decision lives in a
`policy.ts` function with unit tests covering one allow and every deny branch. This is what makes
the matrix above testable rather than aspirational.

## 4. Site scoping

A membership is either `all_sites = true` or has explicit rows in `membership_sites`. Scoping is
applied in the repository layer, not the UI:

```ts
const siteFilter = ctx.allSites ? {} : { siteId: { in: ctx.siteIds } };
```

A user with an empty site scope and `all_sites = false` sees nothing. That is intentional — a
half-configured user must not silently see the whole organization.

## 5. Sensitive data

Fields flagged sensitive (`incident_persons.*` injury detail, `investigation_interviews` marked
sensitive, `attachments.is_sensitive`) are:

- stripped from API responses for callers without `incident.view_sensitive`;
- excluded from CSV/XLSX exports unless the caller holds the permission **and** ticks
  "include sensitive data", which is itself an audit event;
- logged as `VIEW_SENSITIVE` audit events on every read.

## 6. Auditor access

Auditors are invited with an optional `access_expires_at`. A daily job deactivates the membership
on expiry. Every auditor read of a record or export is audited — customers ask who saw what during
an audit, and this is the answer.

## 7. Permission changes

Any role or scope change writes a `PERMISSION_CHANGE` audit event with before/after, notifies the
affected user, and takes effect on their next request (the session carries a `permissions_version`
that is bumped on change, forcing a refresh).

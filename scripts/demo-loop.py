#!/usr/bin/env python3
"""
Walks the complete safety loop against a running server and asserts the
business rules hold at each step.

This is the demo in the source proposal's conclusion, executed:
  report -> classify -> investigate -> 5 Whys -> CAPA -> verify -> close

Usage: BASE=http://127.0.0.1:3101 python3 scripts/demo-loop.py
"""
import json, os, sys, urllib.request, urllib.error, http.cookiejar
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("BASE", "http://127.0.0.1:3101")
PASSWORD = os.environ.get("DEMO_PASSWORD", "Demo!2345")
INVESTIGATOR_ID = "33333333-3333-4333-8333-333333333303"
SITE_ID = "22222222-2222-4222-8222-222222222201"

failures = []

def session():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def call(op, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"content-type": "application/json"})
    try:
        with op.open(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return e.code, {"raw": raw.decode()[:200]}

def login(name):
    op = session()
    status, body = call(op, "POST", "/api/v1/auth/login",
                        {"email": f"{name}@demo.safesphere.app", "password": PASSWORD})
    if status != 200:
        sys.exit(f"login failed for {name}: {status} {body}")
    return op

def check(label, condition, detail=""):
    mark = "PASS" if condition else "FAIL"
    if not condition:
        failures.append(label)
    print(f"   [{mark}] {label}" + (f" -> {detail}" if detail else ""))

def iso(delta_hours=0):
    return (datetime.now(timezone.utc) + timedelta(hours=delta_hours)).strftime("%Y-%m-%dT%H:%M:%SZ")

hse, inv, worker, owner, exec_ = (login(n) for n in ["hse", "inv", "worker", "owner", "exec"])

print("\n1. Worker reports a major incident")
st, r = call(worker, "POST", "/api/v1/incidents", {
    "reportType": "INCIDENT",
    "description": "Scaffold plank gave way under a steel fixer at the Block D slab edge; he fell about 1.8 m onto sand.",
    "siteId": SITE_ID, "occurredAt": iso(-3), "severity": "MAJOR"})
check("report accepted", st == 201, r.get("data", {}).get("reference"))
INC = r["data"]["id"]; INC_REF = r["data"]["reference"]

print("\n2. HSE classifies — risk is derived, investigation is forced")
st, r = call(hse, "POST", f"/api/v1/incidents/{INC}/classify",
             {"severity": "MAJOR", "likelihood": "POSSIBLE", "investigationRequired": False})
d = r.get("data", {})
check("risk computed by the database", d.get("riskScore") == 12 and d.get("riskBand") == "HIGH",
      f"{d.get('riskScore')} / {d.get('riskBand')}")
check("investigation forced despite client sending false", d.get("investigationRequired") is True)

print("\n3. HSE assigns an investigator")
st, r = call(hse, "POST", f"/api/v1/incidents/{INC}/investigation",
             {"leadInvestigatorId": INVESTIGATOR_ID})
check("investigation opened", st == 201, r.get("data", {}).get("status"))
INV = r["data"]["id"]
due = datetime.fromisoformat(r["data"]["due_at"].replace("Z", "+00:00"))
days = round((due - datetime.now(timezone.utc)).total_seconds() / 86400)
check("MAJOR gets a 5-day investigation clock", days == 5, f"{days} days")

print("\n4. Empty investigation cannot be submitted")
st, r = call(inv, "POST", f"/api/v1/investigations/{INV}/submit")
check("submission blocked", st == 422, r.get("error", {}).get("message", "")[:80])

print("\n5. Investigator records the evidence")
call(inv, "POST", f"/api/v1/investigations/{INV}/timeline",
     {"occurredAt": iso(-4), "description": "Plank fitted by night shift without a load-rating check."})
st, r = call(inv, "POST", f"/api/v1/investigations/{INV}/findings",
             {"findingType": "ROOT_CAUSE",
              "statement": "Scaffold planks are released for use without verifying their load rating."})
check("finding recorded", st == 201)
st, r = call(inv, "POST", f"/api/v1/investigations/{INV}/root-causes",
             {"problemStatement": "A scaffold plank failed under normal working load.",
              "statement": "No procedure requires plank load ratings to be verified at shift handover.",
              "category": "MANAGEMENT_SYSTEM"})
check("systemic root cause accepted with no warning", r["data"]["blameWarning"] is None)
RC = r["data"]["id"]

print("\n6. Blame guardrail")
st, r = call(inv, "POST", f"/api/v1/investigations/{INV}/root-causes",
             {"problemStatement": "Plank failed.",
              "statement": "The worker was careless and failed to follow the inspection procedure.",
              "category": "PEOPLE"})
warn = r["data"]["blameWarning"]
check("person-blaming root cause is flagged", warn is not None)
check("but it is still recorded, not blocked", st == 201)

print("\n7. Five Whys")
st, r = call(inv, "PUT", f"/api/v1/root-causes/{RC}/whys", {"steps": [
    {"step": 1, "question": "Why did he fall?", "answer": "A scaffold plank broke under him."},
    {"step": 2, "question": "Why did the plank break?", "answer": "It was rated below the load it carried."}]})
check("two whys rejected", st == 400,
      (r.get("error", {}).get("details") or [{}])[0].get("message", "")[:60])
st, r = call(inv, "PUT", f"/api/v1/root-causes/{RC}/whys", {"steps": [
    {"step": 1, "question": "Why did he fall?", "answer": "A scaffold plank broke under him."},
    {"step": 2, "question": "Why did the plank break?", "answer": "It was rated below the load it carried."},
    {"step": 3, "question": "Why was an under-rated plank in place?", "answer": "Night shift fitted what was to hand."},
    {"step": 4, "question": "Why was that not caught?", "answer": "Handover does not check plank ratings."},
    {"step": 5, "question": "Why not?", "answer": "The handover procedure has no load-rating step."}]})
check("five whys accepted", st == 200 and len(r.get("data", [])) == 5)

print("\n8. CAPA raised from the root cause")
st, r = call(hse, "POST", "/api/v1/actions", {
    "title": "Add a plank load-rating check to the scaffold handover procedure",
    "actionType": "PREVENTIVE", "hierarchyLevel": "ADMINISTRATIVE",
    "ownerUserId": "33333333-3333-4333-8333-333333333305",
    "verifierUserId": "33333333-3333-4333-8333-333333333302",
    "dueDate": (datetime.now(timezone.utc) + timedelta(days=10)).strftime("%Y-%m-%d"),
    "incidentId": INC, "investigationId": INV, "rootCauseId": RC})
check("action created", st == 201, r.get("data", {}).get("reference"))
ACT = r["data"]["id"]

st, r = call(hse, "POST", "/api/v1/actions", {
    "title": "Self-verified action attempt", "actionType": "CORRECTIVE",
    "hierarchyLevel": "PPE", "ownerUserId": "33333333-3333-4333-8333-333333333305",
    "verifierUserId": "33333333-3333-4333-8333-333333333305",
    "dueDate": (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d")})
check("owner cannot be their own verifier", st == 409, r.get("error", {}).get("code"))

print("\n9. Investigation submitted and approved")
st, r = call(inv, "POST", f"/api/v1/investigations/{INV}/submit")
check("submission now succeeds", st == 200, r.get("data", {}).get("status"))
st, r = call(inv, "POST", f"/api/v1/investigations/{INV}/approve")
check("lead cannot approve their own investigation", st == 403, r.get("error", {}).get("code"))
st, r = call(hse, "POST", f"/api/v1/investigations/{INV}/approve")
check("HSE approves", st == 200, r.get("data", {}).get("status"))
st, r = call(hse, "GET", f"/api/v1/incidents/{INC}")
check("incident advanced to ACTIONS_PENDING", r["data"]["status"] == "ACTIONS_PENDING")

print("\n10. Owner works and submits the action")
call(owner, "POST", f"/api/v1/actions/{ACT}/start")
call(owner, "POST", f"/api/v1/actions/{ACT}/updates",
     {"note": "Draft procedure revision circulated to site management.", "progressPercent": 60})
st, r = call(owner, "POST", f"/api/v1/actions/{ACT}/submit", {"note": "Procedure SP-014 rev C issued."})
check("evidence required for a MAJOR-severity action", st == 422,
      r.get("error", {}).get("code"))

print("\n11. Closing the incident with an action still open")
st, r = call(hse, "POST", f"/api/v1/incidents/{INC}/close",
             {"closureStatement": "Attempting to close prematurely."})
check("closure blocked while actions are open", st == 422,
      r.get("error", {}).get("message", "")[:60])

print("\n12. Cancel the action, then close the incident")
st, r = call(hse, "POST", f"/api/v1/actions/{ACT}/cancel",
             {"reason": "Superseded by the group-wide scaffold standard revision."})
check("action cancelled", st == 200, r.get("data", {}).get("status"))
st, r = call(hse, "POST", f"/api/v1/incidents/{INC}/close",
             {"closureStatement": "Root cause addressed by the group scaffold standard revision.",
              "lessonsLearned": "Handover checks must cover component ratings, not just presence."})
check("incident closed", st == 200, r.get("data", {}).get("status"))

print("\n13. Read-only roles stay read-only")
st, r = call(exec_, "POST", "/api/v1/actions", {
    "title": "Executive should not be able to create this", "actionType": "CORRECTIVE",
    "hierarchyLevel": "PPE", "ownerUserId": "33333333-3333-4333-8333-333333333305",
    "dueDate": (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d")})
check("executive cannot create actions", st == 403, r.get("error", {}).get("code"))

print("\n14. Verification path — a standalone action, no evidence gate")
st, r = call(hse, "POST", "/api/v1/actions", {
    "title": "Re-brief all scaffold crews on component load ratings",
    "actionType": "CORRECTIVE", "hierarchyLevel": "ADMINISTRATIVE",
    "ownerUserId": "33333333-3333-4333-8333-333333333305",
    "verifierUserId": "33333333-3333-4333-8333-333333333302",
    "dueDate": (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d")})
check("standalone action created", st == 201, r.get("data", {}).get("reference"))
ACT2 = r["data"]["id"]

call(owner, "POST", f"/api/v1/actions/{ACT2}/start")
st, r = call(owner, "POST", f"/api/v1/actions/{ACT2}/submit", {"note": "Briefings delivered."})
check("submits without evidence when not required", st == 200, r.get("data", {}).get("status"))

# The owner here holds ACTION_OWNER, which lacks action.verify at all, so
# permission fires first. That is correct, but it is not the dangerous case.
st, r = call(owner, "POST", f"/api/v1/actions/{ACT2}/verify", {"effectiveness": "EFFECTIVE"})
check("an owner without verify permission is denied", st == 403, r.get("error", {}).get("code"))

# The real self-verification risk: someone who DOES hold action.verify and
# happens to own the action. This is how a CAPA process quietly becomes theatre.
st, r = call(hse, "POST", "/api/v1/actions", {
    "title": "Action owned by the HSE manager, to test self-verification",
    "actionType": "CORRECTIVE", "hierarchyLevel": "ADMINISTRATIVE",
    "ownerUserId": "33333333-3333-4333-8333-333333333302",
    "dueDate": (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d")})
SELF = r["data"]["id"]
call(hse, "POST", f"/api/v1/actions/{SELF}/start")
call(hse, "POST", f"/api/v1/actions/{SELF}/submit", {"note": "Done."})
st, r = call(hse, "POST", f"/api/v1/actions/{SELF}/verify", {"effectiveness": "EFFECTIVE"})
check("a permitted user still cannot verify an action they own",
      st == 409 and r.get("error", {}).get("code") == "OWNER_CANNOT_VERIFY",
      r.get("error", {}).get("code"))

print("\n15. Verified NOT_EFFECTIVE raises a follow-up automatically")
st, r = call(hse, "POST", f"/api/v1/actions/{ACT2}/verify",
             {"effectiveness": "NOT_EFFECTIVE",
              "comments": "Two crews were missed and the briefing record is incomplete."})
check("verification recorded", st == 200, r.get("data", {}).get("effectiveness"))
follow = r.get("data", {}).get("followUp")
check("follow-up action created automatically", follow is not None,
      follow.get("reference") if follow else None)
if follow:
    st, fr = call(hse, "GET", f"/api/v1/actions/{follow['id']}")
    check("follow-up links back to the original", fr["data"]["parent_action_id"] == ACT2)
    check("follow-up is high priority", fr["data"]["priority"] == "HIGH")

print("\n16. Extension keeps the original due date for metrics")
st, r = call(hse, "POST", "/api/v1/actions", {
    "title": "Install load-rating labels on all scaffold planks",
    "actionType": "PREVENTIVE", "hierarchyLevel": "ENGINEERING",
    "ownerUserId": "33333333-3333-4333-8333-333333333305",
    "dueDate": (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d")})
ACT3 = r["data"]["id"]
st, r = call(hse, "GET", f"/api/v1/actions/{ACT3}")
original_due = r["data"]["original_due_date"][:10]

new_due = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
st, r = call(owner, "POST", f"/api/v1/actions/{ACT3}/extensions",
             {"requestedDueDate": new_due, "reason": "Labels are on a 6-week lead time from the supplier."})
check("extension requested", st == 201)
EXT = r["data"]["id"]

st, r = call(owner, "POST", f"/api/v1/extensions/{EXT}/decide", {"approved": True})
check("owner cannot approve their own extension", st == 403, r.get("error", {}).get("code"))

st, r = call(hse, "POST", f"/api/v1/extensions/{EXT}/decide",
             {"approved": True, "comments": "Supplier lead time accepted."})
check("HSE approves the extension", st == 200)

st, r = call(hse, "GET", f"/api/v1/actions/{ACT3}")
check("due date moved", r["data"]["due_date"][:10] == new_due, r["data"]["due_date"][:10])
check("original due date is immutable — on-time metrics stay honest",
      r["data"]["original_due_date"][:10] == original_due, original_due)

print(f"\n{'=' * 62}")
if failures:
    print(f"FAILED: {len(failures)} check(s): {failures}")
    sys.exit(1)
print(f"All checks passed. Loop complete: {INC_REF} reported -> investigated -> closed.")

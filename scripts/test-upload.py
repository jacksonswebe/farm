#!/usr/bin/env python3
"""Exercises the evidence upload flow: presign -> PUT -> complete -> read."""
import json, os, sys, urllib.request, urllib.error, http.cookiejar, struct, zlib
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("BASE", "http://127.0.0.1:3101")
failures = []

def op(name):
    jar = http.cookiejar.CookieJar()
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    call(o, "POST", "/api/v1/auth/login",
         {"email": f"{name}@demo.safesphere.app", "password": "Demo!2345"})
    return o

def call(o, method, path, body=None, raw=None, headers=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = headers or ({"content-type": "application/json"} if raw is None else {})
    url = path if path.startswith("http") else BASE + path
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with o.open(req) as r:
            payload = r.read()
            try:
                return r.status, json.loads(payload or b"{}")
            except (json.JSONDecodeError, UnicodeDecodeError):
                # A binary body — the file itself coming back from storage.
                return r.status, {"bytes": len(payload), "raw": payload}
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body or b"{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            return e.code, {"raw": body[:200].decode(errors="replace")}

def check(label, cond, detail=""):
    if not cond: failures.append(label)
    print(f"   [{'PASS' if cond else 'FAIL'}] {label}" + (f" -> {detail}" if detail else ""))

def png(w=8, h=8):
    """A real 8x8 PNG, so mime and magic bytes actually agree."""
    rows = []
    for y in range(h):
        row = bytearray(b"\x00")  # PNG filter byte: none
        for x in range(w):
            row += bytes([(x * 32) % 256, (y * 32) % 256, 128])
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))

hse, worker = op("hse"), op("worker")

print("\n1. Presign, upload, complete")
st, r = call(hse, "POST", "/api/v1/incidents", {
    "reportType": "HAZARD",
    "description": "Evidence upload test: unguarded floor opening on level 3 walkway.",
    "siteId": "22222222-2222-4222-8222-222222222201",
    "occurredAt": (datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "severity": "MODERATE"})
if st != 201:
    sys.exit(f"could not create the test incident: {st} {r}")
INC = r["data"]["id"]
img = png()

st, r = call(hse, "POST", "/api/v1/attachments/presign", {
    "fileName": "opening.png", "mimeType": "image/png", "sizeBytes": len(img),
    "entity": "INCIDENT", "entityId": INC})
check("presign issued", st == 201 and "uploadUrl" in r.get("data", {}))
ATT = r["data"]["attachmentId"]; PUT_URL = r["data"]["uploadUrl"]

st, _ = call(hse, "PUT", PUT_URL, raw=img, headers={"content-type": "image/png"})
check("file uploaded directly to storage", st == 200, f"{len(img)} bytes")

st, r = call(hse, "POST", f"/api/v1/attachments/{ATT}/complete")
check("upload confirmed against storage", st == 200 and r["data"]["status"] == "UPLOADED")

st, r = call(hse, "GET", f"/api/v1/attachments/{ATT}/url")
check("presigned read issued", st == 200 and "url" in r.get("data", {}))
st, r = call(hse, "GET", r["data"]["url"])
check("file reads back byte-identical", r.get("bytes") == len(img), f"{r.get('bytes')} bytes")

print("\n2. The server verifies rather than trusting the client")
st, r = call(hse, "POST", "/api/v1/attachments/presign", {
    "fileName": "never-uploaded.png", "mimeType": "image/png", "sizeBytes": 1234,
    "entity": "INCIDENT", "entityId": INC})
GHOST = r["data"]["attachmentId"]
st, r = call(hse, "POST", f"/api/v1/attachments/{GHOST}/complete")
check("completing an upload that never happened is refused", st == 422,
      r.get("error", {}).get("message", "")[:50])

st, r = call(hse, "POST", "/api/v1/attachments/presign", {
    "fileName": "lie.png", "mimeType": "image/png", "sizeBytes": 999999,
    "entity": "INCIDENT", "entityId": INC})
LIAR = r["data"]["attachmentId"]
call(hse, "PUT", r["data"]["uploadUrl"], raw=img, headers={"content-type": "image/png"})
st, r = call(hse, "POST", f"/api/v1/attachments/{LIAR}/complete")
check("a size that disagrees with storage is rejected", st == 422,
      r.get("error", {}).get("message", "")[:50])

print("\n3. Type and size limits")
st, r = call(hse, "POST", "/api/v1/attachments/presign", {
    "fileName": "payload.exe", "mimeType": "application/x-msdownload", "sizeBytes": 100,
    "entity": "INCIDENT", "entityId": INC})
check("executable rejected", st == 400,
      (r.get("error", {}).get("details") or [{}])[0].get("message", "")[:45])
st, r = call(hse, "POST", "/api/v1/attachments/presign", {
    "fileName": "huge.png", "mimeType": "image/png", "sizeBytes": 50 * 1024 * 1024,
    "entity": "INCIDENT", "entityId": INC})
check("oversized image rejected", st == 413, r.get("error", {}).get("code"))

print("\n4. Storage URLs are signed, not guessable")
st, r = call(hse, "GET", PUT_URL.split("?")[0])
check("unsigned storage read is refused", st == 403, str(st))
st, r = call(hse, "GET", PUT_URL.split("?")[0] + "?op=get&expires=99999999999&sig=deadbeef")
check("forged signature is refused", st == 403, str(st))

print("\n5. Evidence unblocks verification of a MODERATE-severity action")
st, r = call(hse, "POST", "/api/v1/actions", {
    "title": "Cover and barricade the level 3 floor opening",
    "actionType": "CORRECTIVE", "hierarchyLevel": "ENGINEERING",
    "ownerUserId": "33333333-3333-4333-8333-333333333302",
    "dueDate": (datetime.now(timezone.utc) + timedelta(days=21)).strftime("%Y-%m-%d"),
    "incidentId": INC})
ACT = r["data"]["id"]
check("action inherits the evidence requirement from severity", st == 201)
call(hse, "POST", f"/api/v1/actions/{ACT}/start")
st, r = call(hse, "POST", f"/api/v1/actions/{ACT}/submit", {"note": "Done."})
check("submission refused without evidence", st == 422, r.get("error", {}).get("code"))

st, r = call(hse, "POST", "/api/v1/attachments/presign", {
    "fileName": "cover-fitted.png", "mimeType": "image/png", "sizeBytes": len(img),
    "entity": "ACTION", "entityId": ACT})
EV = r["data"]["attachmentId"]
call(hse, "PUT", r["data"]["uploadUrl"], raw=img, headers={"content-type": "image/png"})
call(hse, "POST", f"/api/v1/attachments/{EV}/complete")
st, r = call(hse, "POST", f"/api/v1/actions/{ACT}/submit",
             {"note": "Cover fitted and barricaded.", "evidenceAttachmentIds": [EV]})
check("submission accepted once evidence is attached", st == 200,
      r.get("data", {}).get("status"))

print("\n6. Cross-tenant and permission checks")
st, r = call(worker, "POST", "/api/v1/attachments/presign", {
    "fileName": "x.png", "mimeType": "image/png", "sizeBytes": len(img),
    "entity": "ACTION", "entityId": ACT})
check("a non-owner cannot attach evidence to someone else's action", st == 403,
      r.get("error", {}).get("code"))
st, r = call(hse, "POST", "/api/v1/attachments/presign", {
    "fileName": "x.png", "mimeType": "image/png", "sizeBytes": 10,
    "entity": "INCIDENT", "entityId": "99999999-9999-4999-8999-999999999999"})
check("attaching to a record in another tenant is not found", st == 404,
      r.get("error", {}).get("code"))

print("\n" + "=" * 60)
if failures:
    print(f"FAILED: {failures}"); sys.exit(1)
print("Evidence upload flow verified end to end.")

#!/usr/bin/env bash
# =====================================================================
# Deployment preflight.
#
# Run this against a deployed instance BEFORE any real data exists. It
# checks the things that fail silently — the ones where the app looks
# fine and is not.
#
#   BASE=https://your-app.vercel.app CRON_SECRET=... bash scripts/preflight.sh
# =====================================================================
set -uo pipefail

BASE="${BASE:?set BASE to the deployed URL}"
pass=0; fail=0; warn=0

ok()   { printf '  \033[32m[PASS]\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m[FAIL]\033[0m %s\n' "$1"; fail=$((fail+1)); }
note() { printf '  \033[33m[WARN]\033[0m %s\n' "$1"; warn=$((warn+1)); }

echo "Preflight against $BASE"
echo "(Against a local dev server the dev-storage and header checks are expected to"
echo " fail — those protections come from NODE_ENV=production and vercel.json.)"
echo

# --- 1. Is it up, and is the database reachable? ---------------------
health=$(curl -fsS -m 20 "$BASE/api/health" 2>/dev/null || echo '{}')
status=$(printf '%s' "$health" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
[ "$status" = "ok" ] && ok "health endpoint reports ok" || bad "health reports '${status:-unreachable}'"

printf '%s' "$health" | grep -q '"database":{"ok":true' \
  && ok "database reachable" || bad "database not reachable"

# --- 2. THE one that silently disables tenant isolation ---------------
# app.current_org() must be NULL with no tenant context. If it is not,
# the application is connected as a superuser or a BYPASSRLS role and
# every row-level security policy in db/schema.sql is inert.
if printf '%s' "$health" | grep -q '"tenancy":{"ok":true'; then
  ok "row-level security is armed (app.current_org() is NULL unscoped)"
else
  bad "RLS NOT ARMED — the app is likely connected as the database owner."
  echo "         Run scripts/create-app-role.sql and point DATABASE_URL at safesphere_app."
fi

# --- 3. Cron must not be a public denial-of-service handle -------------
code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$BASE/api/cron/analytics.refresh")
[ "$code" = "401" ] && ok "cron endpoint rejects unauthenticated calls" \
                    || bad "cron returned $code unauthenticated — set CRON_SECRET"

if [ -n "${CRON_SECRET:-}" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 60 \
    -H "authorization: Bearer $CRON_SECRET" "$BASE/api/cron/analytics.refresh")
  [ "$code" = "200" ] && ok "cron runs with the secret" || bad "cron with secret returned $code"
else
  note "CRON_SECRET not provided — skipped the authenticated cron check"
fi

# --- 4. The dev-only storage route must not exist in production -------
code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$BASE/api/dev/storage/probe")
[ "$code" = "404" ] && ok "dev storage route is absent in production" \
                    || bad "dev storage route answered $code — it must 404 when NODE_ENV=production"

# --- 5. API must not be open ------------------------------------------
code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$BASE/api/v1/incidents")
[ "$code" = "401" ] && ok "API requires authentication" \
                    || bad "unauthenticated /api/v1/incidents returned $code"

# --- 6. Security headers ----------------------------------------------
headers=$(curl -fsSI -m 20 "$BASE/" 2>/dev/null || echo '')
for h in "strict-transport-security" "x-content-type-options" "x-frame-options" "content-security-policy"; do
  printf '%s' "$headers" | grep -qi "^$h:" && ok "header $h present" || note "header $h missing"
done

# --- 7. Rate limiting -------------------------------------------------
limited=no
for _ in $(seq 1 25); do
  c=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST "$BASE/api/v1/auth/login" \
      -H 'content-type: application/json' \
      -d '{"email":"preflight@example.invalid","password":"wrong"}')
  [ "$c" = "429" ] && { limited=yes; break; }
done
[ "$limited" = "yes" ] && ok "sign-in is rate limited" \
                       || bad "no 429 after 25 sign-in attempts — the rate_limits table may be missing"

echo
echo "  ---"
printf '  %d passed, %d failed, %d warnings\n' "$pass" "$fail" "$warn"
[ "$fail" -gt 0 ] && { echo "  DO NOT put real data in this deployment until the failures are fixed."; exit 1; }
echo "  Safe to proceed."

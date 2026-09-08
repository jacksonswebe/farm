#!/usr/bin/env bash
# =====================================================================
# Tenant isolation suite.
#
# The five assertions that stand between us and a cross-tenant data
# breach. A breach here means one customer reading another customer's
# injury records — company-ending in an EHS product.
#
# Runs as a NOBYPASSRLS role against a database with two seeded tenants.
# Merge gate in .github/workflows/ci.yml.
# =====================================================================
set -uo pipefail

PGHOST_="${PGHOST_:-localhost}"
PGPORT_="${PGPORT_:-5432}"
DB="${DB:-safesphere_rls}"
APP_USER="${APP_USER:-app_ci}"
APP_PASS="${APP_PASS:-ci}"

ORG_A="11111111-1111-4111-8111-111111111111"   # from db/seed.sql
ORG_B="99999999-9999-4999-8999-999999999999"

pass=0; fail=0

# Run SQL as the application role inside a transaction with the tenant
# context set exactly as withTenant() does at runtime.
scoped() {
  PGPASSWORD="$APP_PASS" psql -h "$PGHOST_" -p "$PGPORT_" -U "$APP_USER" -d "$DB" -tA \
    -c "BEGIN; SELECT set_config('app.current_org_id','$1',true); $2 COMMIT;" 2>&1
}
unscoped() {
  PGPASSWORD="$APP_PASS" psql -h "$PGHOST_" -p "$PGPORT_" -U "$APP_USER" -d "$DB" -tA -c "$1" 2>&1
}
num() { grep -E '^[0-9]+$' | head -1; }

check() { # name expected actual
  if [ "$2" = "$3" ]; then
    printf '  ✓ %s\n' "$1"; pass=$((pass+1))
  else
    printf '  ✗ %s — expected %s, got %s\n' "$1" "$2" "$3"; fail=$((fail+1))
  fi
}

echo "Tenant isolation suite (role: $APP_USER, NOBYPASSRLS)"

# 1. Fail closed. app.current_org() returns NULL when unset, so every
#    RLS policy denies. A forgotten withTenant() must leak nothing.
check "no tenant context returns zero rows" \
      "0" "$(unscoped 'SELECT count(*) FROM incidents;' | num)"

# 2. A scoped read sees its own tenant.
check "tenant A sees its own records" \
      "131" "$(scoped "$ORG_A" 'SELECT count(*) FROM incidents;' | num)"

# 3. ...and only its own.
check "tenant B cannot read tenant A's records" \
      "0" "$(scoped "$ORG_B" "SELECT count(*) FROM incidents WHERE reference='INC-2026-0001';" | num)"

# 4. WITH CHECK blocks writes into another tenant, not just reads.
res=$(scoped "$ORG_B" "INSERT INTO incidents (organization_id,reference,report_type,status,description,site_id,occurred_at)
      VALUES ('$ORG_A','INC-XTENANT','HAZARD','SUBMITTED','cross-tenant write attempt',
      (SELECT id FROM sites LIMIT 1), now());")
check "cross-tenant INSERT is rejected" \
      "1" "$(printf '%s' "$res" | grep -c 'row-level security')"

# 5. The audit trail is append-only for the application role.
res=$(scoped "$ORG_A" 'DELETE FROM audit_events;')
check "audit_events cannot be deleted by the app role" \
      "1" "$(printf '%s' "$res" | grep -c 'permission denied')"

echo "  ---"
if [ "$fail" -gt 0 ]; then
  echo "  FAILED: $pass passed, $fail failed"
  exit 1
fi
echo "  OK: $pass/5 passed"

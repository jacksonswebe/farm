import { Prisma } from '@prisma/client';
import { prisma } from './client';

/**
 * A Prisma client bound to one tenant's transaction.
 *
 * Every query the application makes runs through withTenant(). The database
 * is the enforcing layer, not this function: app.current_org_id drives the
 * RLS policy on every tenant table, and app.current_org() returns NULL when
 * it is unset — so a query that escapes this wrapper returns zero rows
 * rather than another customer's injury records.
 *
 * See docs/02-TECHNICAL-BLUEPRINT.md section 4.
 */
export type TenantTx = Omit<
  Prisma.TransactionClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function withTenant<T>(
  orgId: string,
  fn: (tx: TenantTx) => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  // A malformed org id must never reach set_config: an empty or bogus value
  // would make app.current_org() NULL and silently return empty result sets
  // that look like "no data" rather than "broken tenancy".
  if (!UUID_RE.test(orgId)) {
    throw new Error(`withTenant called with an invalid organization id: ${JSON.stringify(orgId)}`);
  }

  return prisma.$transaction(
    async (tx) => {
      // `true` = SET LOCAL: scoped to this transaction, so it is safe under
      // transaction-mode connection pooling and cannot leak to the next
      // request that borrows this connection.
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}::text, true)`;
      return fn(tx);
    },
    { timeout: opts.timeoutMs ?? 15_000 },
  );
}

/**
 * Escape hatch for the few genuinely cross-tenant operations: resolving a
 * login by email, resolving a site's anonymous-report token to its org, and
 * the job runner picking up work before it knows the tenant.
 *
 * Named to be conspicuous in review. If you are reaching for this inside a
 * request handler, you almost certainly want withTenant().
 */
export function unsafeGlobalQuery(): typeof prisma {
  return prisma;
}

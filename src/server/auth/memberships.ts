import type { org_role } from '@prisma/client';
import { unsafeGlobalQuery } from '@/server/db/tenant';

/**
 * Resolving a user's organizations is the one read that cannot go through
 * withTenant(): it is what decides which tenant to scope to. `memberships`
 * is RLS-protected, so a direct read here returns zero rows and every login
 * fails with ORG_CONTEXT_REQUIRED.
 *
 * app.user_memberships() is a SECURITY DEFINER function returning only the
 * given user's own memberships. See db/schema.sql.
 */
export interface ResolvedMembership {
  organizationId: string;
  organizationName: string;
  role: org_role;
  allSites: boolean;
  siteIds: string[];
}

interface MembershipRow {
  organization_id: string;
  organization_name: string;
  role: org_role;
  all_sites: boolean;
  site_ids: string[] | null;
}

export async function resolveMemberships(userId: string): Promise<ResolvedMembership[]> {
  const rows = await unsafeGlobalQuery().$queryRaw<MembershipRow[]>`
    SELECT organization_id, organization_name, role, all_sites, site_ids
    FROM app.user_memberships(${userId}::uuid)
  `;

  return rows.map((r) => ({
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    role: r.role,
    allSites: r.all_sites,
    siteIds: r.site_ids ?? [],
  }));
}

export async function resolveMembership(
  userId: string,
  organizationId: string,
): Promise<ResolvedMembership | null> {
  const all = await resolveMemberships(userId);
  return all.find((m) => m.organizationId === organizationId) ?? null;
}

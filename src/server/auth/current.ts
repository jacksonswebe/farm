import { AppError, ErrorCode } from '@/server/lib/errors';
import { unsafeGlobalQuery } from '@/server/db/tenant';
import type { Ctx } from './context';
import { readSession } from './session';

/**
 * Builds the request Ctx: who is calling, for which organization, with what
 * role and site scope. Membership is re-read per request rather than trusted
 * from the cookie, so a revoked role takes effect immediately.
 */
export async function getCtx(requestId: string): Promise<Ctx | null> {
  const session = await readSession();
  if (!session) return null;

  const membership = await unsafeGlobalQuery().memberships.findUnique({
    where: {
      organization_id_user_id: {
        organization_id: session.orgId,
        user_id: session.userId,
      },
    },
    include: { membership_sites: { select: { site_id: true } } },
  });

  if (!membership || !membership.is_active) return null;

  return {
    userId: session.userId,
    orgId: session.orgId,
    role: membership.role,
    allSites: membership.all_sites,
    siteIds: membership.membership_sites.map((s) => s.site_id),
    requestId,
  };
}

export async function requireCtx(requestId: string): Promise<Ctx> {
  const ctx = await getCtx(requestId);
  if (!ctx) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Sign in to continue.');
  }
  return ctx;
}

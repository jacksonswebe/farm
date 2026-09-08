import { AppError, ErrorCode } from '@/server/lib/errors';
import type { Ctx } from './context';
import { resolveMembership } from './memberships';
import { readSession } from './session';

/**
 * Builds the request Ctx: who is calling, for which organization, with what
 * role and site scope. Membership is re-read per request rather than trusted
 * from the cookie, so a revoked role takes effect immediately.
 */
export async function getCtx(requestId: string): Promise<Ctx | null> {
  const session = await readSession();
  if (!session) return null;

  const membership = await resolveMembership(session.userId, session.orgId);
  if (!membership) return null;

  return {
    userId: session.userId,
    orgId: session.orgId,
    role: membership.role,
    allSites: membership.allSites,
    siteIds: membership.siteIds,
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

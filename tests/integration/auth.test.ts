import { describe, expect, it } from 'vitest';
import { resolveMembership, resolveMemberships } from '@/server/auth/memberships';
import { unsafeGlobalQuery } from '@/server/db/tenant';

const HSE_USER = '33333333-3333-4333-8333-333333333302';
const WORKER = '33333333-3333-4333-8333-333333333306';
const ORG_A = '11111111-1111-4111-8111-111111111111';

describe('membership resolution during authentication', () => {
  /**
   * Regression test.
   *
   * Authentication has a chicken-and-egg problem with RLS: discovering which
   * organization a user belongs to requires reading `memberships`, but that
   * table is RLS-protected and the tenant context does not exist until after
   * the membership is known.
   *
   * The original login read memberships directly, got zero rows under RLS,
   * and rejected every sign-in with ORG_CONTEXT_REQUIRED. It only appeared to
   * work while the app connected as a superuser.
   */
  it('cannot read memberships directly without a tenant context', async () => {
    const direct = await unsafeGlobalQuery().memberships.findMany({ select: { id: true } });
    expect(direct).toHaveLength(0);
  });

  it('resolves a user’s own memberships during login', async () => {
    const memberships = await resolveMemberships(HSE_USER);
    expect(memberships.length).toBeGreaterThan(0);
    expect(memberships[0]!.organizationId).toBe(ORG_A);
    expect(memberships[0]!.role).toBe('HSE_MANAGER');
    expect(memberships[0]!.allSites).toBe(true);
  });

  it('returns the site scope for a scoped user', async () => {
    const membership = await resolveMembership(WORKER, ORG_A);
    expect(membership).not.toBeNull();
    expect(membership!.role).toBe('EMPLOYEE');
    expect(membership!.allSites).toBe(false);
    // A scoped user with no sites would see nothing — that is intentional,
    // but the seed grants one, so assert it is actually populated.
    expect(membership!.siteIds.length).toBeGreaterThan(0);
  });

  it('returns nothing for a user with no membership in that org', async () => {
    expect(await resolveMembership(HSE_USER, '99999999-9999-4999-8999-999999999999')).toBeNull();
  });

  it('leaks no other user’s memberships', async () => {
    const forWorker = await resolveMemberships(WORKER);
    expect(forWorker.every((m) => m.role === 'EMPLOYEE')).toBe(true);
    expect(forWorker).toHaveLength(1);
  });
});

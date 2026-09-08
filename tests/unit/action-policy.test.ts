import { describe, expect, it } from 'vitest';
import type { Ctx } from '@/server/auth/context';
import { actionPolicy, evidenceRequiredFor, isOverdue } from '@/server/modules/actions/policy';

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  userId: 'hse-1', orgId: '11111111-1111-4111-8111-111111111111',
  role: 'HSE_MANAGER', allSites: true, siteIds: [], requestId: 'req', ...over,
});

const action = (over: Record<string, unknown> = {}) =>
  ({
    id: 'act-1', status: 'PENDING_VERIFICATION', owner_user_id: 'owner-1',
    verifier_user_id: null, site_id: 'site-1',
    due_date: new Date(Date.now() + 86_400_000), ...over,
  }) as Parameters<typeof actionPolicy.assertCanVerify>[1];

describe('self-verification is impossible', () => {
  it('blocks the owner even when they hold the verify permission', () => {
    // The dangerous case: an HSE manager who owns the action. A role check
    // alone would let this through.
    expect(() => actionPolicy.assertCanVerify(ctx({ userId: 'owner-1' }), action())).toThrow(
      /cannot be verified by its own owner/,
    );
  });

  it('allows a different person with the permission', () => {
    expect(() => actionPolicy.assertCanVerify(ctx(), action())).not.toThrow();
  });

  it('only verifies an action that was actually submitted', () => {
    expect(() => actionPolicy.assertCanVerify(ctx(), action({ status: 'OPEN' }))).toThrow(
      /submitted for verification/,
    );
  });

  it('blocks the owner from approving their own extension', () => {
    expect(() =>
      actionPolicy.assertCanDecideExtension(ctx({ userId: 'owner-1' }), action()),
    ).toThrow(/your own extension/);
  });
});

describe('evidence requirement follows source severity', () => {
  it('requires evidence from moderate upwards', () => {
    expect(evidenceRequiredFor('MODERATE')).toBe(true);
    expect(evidenceRequiredFor('MAJOR')).toBe(true);
    expect(evidenceRequiredFor('CATASTROPHIC')).toBe(true);
  });
  it('does not require it below that', () => {
    expect(evidenceRequiredFor('MINOR')).toBe(false);
    expect(evidenceRequiredFor('NEGLIGIBLE')).toBe(false);
    expect(evidenceRequiredFor(null)).toBe(false);
  });
});

describe('overdue is derived, not stored', () => {
  const yesterday = new Date(Date.now() - 86_400_000);
  const tomorrow = new Date(Date.now() + 86_400_000);

  it('flags an open action past its due date', () => {
    expect(isOverdue({ status: 'OPEN', due_date: yesterday })).toBe(true);
    expect(isOverdue({ status: 'IN_PROGRESS', due_date: yesterday })).toBe(true);
    expect(isOverdue({ status: 'REJECTED', due_date: yesterday })).toBe(true);
  });

  it('never flags a closed or cancelled action', () => {
    expect(isOverdue({ status: 'VERIFIED_CLOSED', due_date: yesterday })).toBe(false);
    expect(isOverdue({ status: 'CANCELLED', due_date: yesterday })).toBe(false);
  });

  it('does not flag an action awaiting verification', () => {
    // The owner has done their part; the clock is on the verifier.
    expect(isOverdue({ status: 'PENDING_VERIFICATION', due_date: yesterday })).toBe(false);
  });

  it('does not flag one still in date', () => {
    expect(isOverdue({ status: 'OPEN', due_date: tomorrow })).toBe(false);
  });
});

describe('visibility', () => {
  it('shows an action owner only what they own or verify', () => {
    const owner = ctx({ role: 'ACTION_OWNER', userId: 'owner-1', allSites: false, siteIds: [] });
    expect(actionPolicy.canView(owner, action())).toBe(true);
    expect(actionPolicy.canView(owner, action({ owner_user_id: 'someone-else' }))).toBe(false);
  });
});

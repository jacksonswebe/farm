import { describe, expect, it } from 'vitest';
import type { Ctx } from '@/server/auth/context';
import {
  defaultInvestigationDueAt,
  detectBlame,
  investigationPolicy,
} from '@/server/modules/investigations/policy';

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  userId: 'lead-1', orgId: '11111111-1111-4111-8111-111111111111',
  role: 'HSE_MANAGER', allSites: true, siteIds: [], requestId: 'req', ...over,
});

const inv = (over: Record<string, unknown> = {}) =>
  ({ id: 'inv-1', status: 'IN_PROGRESS', lead_investigator_id: 'lead-1', team_user_ids: [], ...over }) as
    Parameters<typeof investigationPolicy.assertCanEdit>[1];

describe('investigation due dates scale with severity', () => {
  const days = (s: Parameters<typeof defaultInvestigationDueAt>[0]) => {
    const from = new Date('2026-01-01T00:00:00Z');
    return Math.round((defaultInvestigationDueAt(s, from).getTime() - from.getTime()) / 86_400_000);
  };
  it('gives a catastrophic event two days', () => expect(days('CATASTROPHIC')).toBe(2));
  it('gives a major event five', () => expect(days('MAJOR')).toBe(5));
  it('gives a moderate event seven', () => expect(days('MODERATE')).toBe(7));
  it('gives a minor event fourteen', () => expect(days('MINOR')).toBe(14));
  it('defaults to seven when severity is unknown', () => expect(days(null)).toBe(7));
});

describe('submission guards', () => {
  it('refuses a submission with no findings, causes or actions', () => {
    expect(() =>
      investigationPolicy.assertCanSubmit(ctx(), inv(), { findings: 0, rootCauses: 0, actions: 0 }),
    ).toThrow(/at least one finding.*at least one root cause.*at least one corrective/s);
  });

  it('names only what is actually missing', () => {
    expect(() =>
      investigationPolicy.assertCanSubmit(ctx(), inv(), { findings: 2, rootCauses: 1, actions: 0 }),
    ).toThrow(/at least one corrective or preventive action/);
  });

  it('allows a complete investigation through', () => {
    expect(() =>
      investigationPolicy.assertCanSubmit(ctx(), inv(), { findings: 1, rootCauses: 1, actions: 1 }),
    ).not.toThrow();
  });
});

describe('approval separation of duties', () => {
  it('stops the lead approving their own investigation', () => {
    expect(() =>
      investigationPolicy.assertCanDecide(ctx({ userId: 'lead-1' }), inv({ status: 'SUBMITTED' })),
    ).toThrow(/other than its lead/);
  });

  it('lets a different HSE manager approve', () => {
    expect(() =>
      investigationPolicy.assertCanDecide(ctx({ userId: 'hse-2' }), inv({ status: 'SUBMITTED' })),
    ).not.toThrow();
  });

  it('only accepts a decision on a submitted investigation', () => {
    expect(() =>
      investigationPolicy.assertCanDecide(ctx({ userId: 'hse-2' }), inv({ status: 'IN_PROGRESS' })),
    ).toThrow(/submitted/);
  });
});

describe('editing window', () => {
  it('locks an approved investigation', () => {
    expect(() => investigationPolicy.assertCanEdit(ctx(), inv({ status: 'APPROVED' }))).toThrow(
      /closed record/,
    );
  });
  it('reopens a returned investigation for rework', () => {
    expect(() => investigationPolicy.assertCanEdit(ctx(), inv({ status: 'RETURNED' }))).not.toThrow();
  });
  it('hides an investigation an investigator is not on', () => {
    const other = ctx({ role: 'INVESTIGATOR', userId: 'someone-else' });
    expect(() => investigationPolicy.assertCanView(other, inv())).toThrow(/not found/i);
  });
});

describe('blame guardrail', () => {
  it.each([
    'The operator error caused the spill',
    'Worker was careless with the load',
    'He failed to follow the isolation procedure',
    'The technician was complacent about the checks',
  ])('flags "%s"', (statement) => {
    expect(detectBlame(statement)).not.toBeNull();
  });

  it.each([
    'No procedure requires plank load ratings to be verified at handover',
    'The guard was removed during maintenance and never reinstated',
    'Anchor provision is not a gate condition for releasing a platform',
  ])('leaves the systemic statement "%s" alone', (statement) => {
    expect(detectBlame(statement)).toBeNull();
  });
});

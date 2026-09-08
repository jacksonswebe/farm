import { describe, expect, it } from 'vitest';
import type { Ctx } from '@/server/auth/context';
import { investigationPolicy } from '@/server/modules/investigations/policy';

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  userId: 'u', orgId: '11111111-1111-4111-8111-111111111111',
  role: 'HSE_MANAGER', allSites: true, siteIds: [], requestId: 'r', ...over,
});

const inv = {
  id: 'i',
  status: 'IN_PROGRESS' as const,
  lead_investigator_id: 'lead',
  team_user_ids: ['member'],
};

/**
 * Regression test.
 *
 * is_sensitive was written on interview creation and never read back, so a
 * statement marked sensitive was returned in full to anyone who could view
 * the investigation. The read now withholds the notes from everyone outside
 * HSE and the investigation team.
 */
describe('sensitive interview visibility', () => {
  const canRead = (c: Ctx) => c.role === 'HSE_MANAGER' || investigationPolicy.isOnTeam(c, inv);

  it('lets the lead investigator read them', () => {
    expect(canRead(ctx({ role: 'INVESTIGATOR', userId: 'lead' }))).toBe(true);
  });
  it('lets a team member read them', () => {
    expect(canRead(ctx({ role: 'INVESTIGATOR', userId: 'member' }))).toBe(true);
  });
  it('lets HSE read them', () => {
    expect(canRead(ctx({ userId: 'anyone' }))).toBe(true);
  });
  it('withholds them from a site manager who can otherwise view the investigation', () => {
    expect(canRead(ctx({ role: 'SITE_MANAGER', userId: 'sm' }))).toBe(false);
  });
  it('withholds them from an auditor', () => {
    expect(canRead(ctx({ role: 'AUDITOR', userId: 'aud' }))).toBe(false);
  });
  it('withholds them from an executive', () => {
    expect(canRead(ctx({ role: 'EXECUTIVE', userId: 'ex' }))).toBe(false);
  });
});

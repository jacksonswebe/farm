import { beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@/server/db/tenant';
import { claimNotifications, claimKey } from '@/server/jobs/handlers/notification-claim';
import { escalateOverdueActions, remindActionsDue } from '@/server/jobs/handlers/reminders';

const ORG_A = '11111111-1111-4111-8111-111111111111';

describe('claimNotifications', () => {
  /**
   * Regression test.
   *
   * The original implementation claimed sends with try/insert/catch. A
   * unique violation aborts the entire PostgreSQL transaction (25P02), so
   * the first duplicate silently killed the rest of the run — reminders and
   * escalations would just stop, with one logged error and no alert.
   *
   * This asserts the transaction survives a duplicate claim.
   */
  it('survives a duplicate claim without aborting the transaction', async () => {
    const scheduledFor = new Date('2030-01-01T00:00:00Z');
    const ruleKey = `TEST_CLAIM:${Date.now()}`;

    await withTenant(ORG_A, async (tx) => {
      const action = await tx.actions.findFirst({ select: { id: true, owner_user_id: true } });
      expect(action).toBeTruthy();

      const claims = [{ entityId: action!.id, recipientUserId: action!.owner_user_id }];
      const params = { organizationId: ORG_A, entity: 'ACTION' as const, ruleKey, scheduledFor, claims };

      const first = await claimNotifications(tx, params);
      expect(first.size).toBe(1);

      // The duplicate must return an empty set, not throw.
      const second = await claimNotifications(tx, params);
      expect(second.size).toBe(0);

      // The transaction must still be usable — this is the whole point.
      const stillWorks = await tx.actions.count();
      expect(stillWorks).toBeGreaterThan(0);
    });
  });

  it('claims only the rows not already claimed, in a mixed batch', async () => {
    const scheduledFor = new Date('2030-01-02T00:00:00Z');
    const ruleKey = `TEST_MIXED:${Date.now()}`;

    await withTenant(ORG_A, async (tx) => {
      const actions = await tx.actions.findMany({
        take: 3,
        select: { id: true, owner_user_id: true },
      });
      const claims = actions.map((a) => ({ entityId: a.id, recipientUserId: a.owner_user_id }));
      const base = { organizationId: ORG_A, entity: 'ACTION' as const, ruleKey, scheduledFor };

      const firstOnly = await claimNotifications(tx, { ...base, claims: [claims[0]!] });
      expect(firstOnly.size).toBe(1);

      const rest = await claimNotifications(tx, { ...base, claims });
      expect(rest.size).toBe(claims.length - 1);
      expect(rest.has(claimKey(claims[0]!.entityId, claims[0]!.recipientUserId))).toBe(false);
    });
  });
});

describe('scheduled jobs', () => {
  beforeAll(async () => {
    // Clear prior claims so the run is deterministic.
    await withTenant(ORG_A, (tx) =>
      tx.notification_log.deleteMany({ where: { rule_key: { startsWith: 'ACTION_' } } }),
    );
  });

  it('sends reminders once and never twice', async () => {
    const now = new Date();
    const first = await remindActionsDue(now);
    expect(first.errors).toBe(0);

    const second = await remindActionsDue(now);
    expect(second.errors).toBe(0);
    expect(second.processed).toBe(0);
    expect(second.skipped).toBe(first.processed + first.skipped);
  });

  it('escalates overdue actions once per tier', async () => {
    const now = new Date();
    const first = await escalateOverdueActions(now);
    expect(first.errors).toBe(0);
    expect(first.processed).toBeGreaterThan(0);

    const second = await escalateOverdueActions(now);
    expect(second.errors).toBe(0);
    expect(second.processed).toBe(0);
  });
});

describe('job runner tenant enumeration', () => {
  /**
   * Regression test.
   *
   * activeOrgIds() originally read `organizations` directly, outside any
   * tenant context. RLS correctly returned zero rows, so every scheduled job
   * iterated an empty list and reported success having done nothing — no
   * reminders, no escalations, no error. It only appeared to work because
   * the app was connecting as a superuser, which bypasses RLS.
   *
   * This asserts the app role can still enumerate tenants.
   */
  it('sees organizations as the unprivileged application role', async () => {
    const { unsafeGlobalQuery } = await import('@/server/db/tenant');
    const direct = await unsafeGlobalQuery().organizations.findMany({ select: { id: true } });
    // RLS must still hide tenant rows from an unscoped read.
    expect(direct).toHaveLength(0);

    const viaFunction = await unsafeGlobalQuery().$queryRaw<{ id: string }[]>`
      SELECT app.active_organization_ids()::text AS id
    `;
    expect(viaFunction.length).toBeGreaterThan(0);
  });
});

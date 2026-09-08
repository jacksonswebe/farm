import { describe, expect, it } from 'vitest';
import { unsafeGlobalQuery, withTenant } from '@/server/db/tenant';

/**
 * Tenant isolation through the application layer.
 *
 * scripts/verify-tenancy.sh proves the database enforces isolation with raw
 * SQL. This proves the code path the application actually uses — withTenant()
 * — sets the context correctly and that a malformed org id fails loudly
 * instead of silently returning an empty result set.
 */
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '99999999-9999-4999-8999-999999999999';

describe('withTenant', () => {
  it('rejects a malformed organization id instead of returning nothing', async () => {
    // The dangerous failure is silent: an empty orgId would make
    // app.current_org() NULL and every query would look like "no data".
    await expect(withTenant('', async () => 1)).rejects.toThrow(/invalid organization id/i);
    await expect(withTenant('not-a-uuid', async () => 1)).rejects.toThrow(
      /invalid organization id/i,
    );
  });

  it('sets the tenant context inside the transaction', async () => {
    const org = await withTenant(ORG_A, async (tx) => {
      const rows = await tx.$queryRaw<{ org: string }[]>`SELECT app.current_org()::text AS org`;
      return rows[0]?.org;
    });
    expect(org).toBe(ORG_A);
  });

  it('does not leak the context outside the transaction', async () => {
    await withTenant(ORG_A, async (tx) => tx.$queryRaw`SELECT 1`);
    // SET LOCAL is transaction-scoped, so the next connection borrower sees
    // nothing. This is what makes transaction-mode pooling safe.
    const rows = await unsafeGlobalQuery().$queryRaw<
      { org: string | null }[]
    >`SELECT app.current_org()::text AS org`;
    expect(rows[0]?.org).toBeNull();
  });

  it('scopes reads to the active tenant', async () => {
    const inA = await withTenant(ORG_A, (tx) => tx.incidents.count());
    expect(inA).toBeGreaterThan(100);

    const seesAsB = await withTenant(ORG_B, (tx) =>
      tx.incidents.count({ where: { reference: 'INC-2026-0001' } }),
    );
    expect(seesAsB).toBe(0);
  });

  it('refuses a write into another tenant', async () => {
    await expect(
      withTenant(ORG_B, (tx) =>
        tx.incidents.create({
          data: {
            organization_id: ORG_A,
            reference: `INC-XTENANT-${Date.now()}`,
            report_type: 'HAZARD',
            status: 'SUBMITTED',
            description: 'cross-tenant write attempt from the application layer',
            site_id: '22222222-2222-4222-8222-222222222201',
            occurred_at: new Date(),
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('reference numbers', () => {
  it('are gapless and sequential per organization', async () => {
    const refs = await withTenant(ORG_A, async (tx) => {
      const out: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const rows = await tx.$queryRaw<{ r: string }[]>`
          SELECT app.next_reference(${ORG_A}::uuid, 'TEST') AS r`;
        out.push(rows[0]!.r);
      }
      return out;
    });

    const numbers = refs.map((r) => Number(r.split('-')[2]));
    expect(numbers[1]).toBe(numbers[0]! + 1);
    expect(numbers[2]).toBe(numbers[1]! + 1);
    expect(refs[0]).toMatch(/^TEST-\d{4}-\d{4}$/);
  });
});

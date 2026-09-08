import { beforeAll, describe, expect, it } from 'vitest';
import { unsafeGlobalQuery, withTenant } from '@/server/db/tenant';
import { enforceRateLimit } from '@/server/lib/ratelimit';
import { AppError } from '@/server/lib/errors';
import { incidentService } from '@/server/modules/incidents/service';
import type { Ctx } from '@/server/auth/context';

const ORG = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222201';
const hse: Ctx = {
  userId: '33333333-3333-4333-8333-333333333302',
  orgId: ORG, role: 'HSE_MANAGER', allSites: true, siteIds: [], requestId: 'req_test',
};

describe('idempotency on report submission', () => {
  /**
   * Regression test.
   *
   * The client sent an Idempotency-Key and the API spec documented it, but the
   * route never read it. An offline-queued report retrying on reconnect would
   * have created a second incident with a second reference number — exactly
   * the failure the header exists to prevent.
   */
  it('returns the original record instead of creating a duplicate', async () => {
    const key = `test-idem-${Date.now()}`;
    const input = {
      reportType: 'HAZARD' as const,
      description: 'Idempotency check: a duplicate submission must resolve to the original.',
      siteId: SITE,
      occurredAt: new Date(Date.now() - 3600_000),
      asDraft: false,
      attachmentIds: [] as string[],
    };

    const first = await incidentService.create(hse, input, key);
    const replay = await incidentService.create(hse, input, key);

    expect(replay.id).toBe(first.id);
    expect(replay.reference).toBe(first.reference);

    const count = await withTenant(ORG, (tx) =>
      tx.incidents.count({ where: { idempotency_key: key } }),
    );
    expect(count).toBe(1);
  });

  it('still creates separate records without a key', async () => {
    const input = {
      reportType: 'HAZARD' as const,
      description: 'Two genuinely separate reports must not be collapsed together.',
      siteId: SITE,
      occurredAt: new Date(Date.now() - 3600_000),
      asDraft: false,
      attachmentIds: [] as string[],
    };
    const a = await incidentService.create(hse, input);
    const b = await incidentService.create(hse, input);
    expect(a.id).not.toBe(b.id);
  });
});

describe('rate limiting', () => {
  beforeAll(async () => {
    await unsafeGlobalQuery().$executeRaw`DELETE FROM rate_limits WHERE bucket LIKE 'test:%'`;
  });

  it('allows up to the limit and refuses beyond it', async () => {
    const rule = { key: `test:${Date.now()}`, limit: 3, windowSeconds: 60 };
    for (let i = 0; i < 3; i += 1) {
      await expect(enforceRateLimit(rule)).resolves.toBeUndefined();
    }
    await expect(enforceRateLimit(rule)).rejects.toThrow(AppError);
    await expect(enforceRateLimit(rule)).rejects.toThrow(/Too many/);
  });

  it('counts each bucket separately', async () => {
    const stamp = Date.now();
    const a = { key: `test:a:${stamp}`, limit: 1, windowSeconds: 60 };
    const b = { key: `test:b:${stamp}`, limit: 1, windowSeconds: 60 };
    await enforceRateLimit(a);
    // A different subject must not inherit the first one's count.
    await expect(enforceRateLimit(b)).resolves.toBeUndefined();
    await expect(enforceRateLimit(a)).rejects.toThrow(/Too many/);
  });
});

describe('full-text search', () => {
  /**
   * Regression test.
   *
   * `q` was declared in the list schema and never used, so a user typing a
   * search term got the unfiltered list back and no indication that their
   * search had been discarded — a wrong answer presented as a right one.
   */
  it('narrows results to matches', async () => {
    const all = await incidentService.list(hse, { limit: 50, cursor: undefined } as never);
    const hits = await incidentService.list(hse, { limit: 50, q: 'scaffold' } as never);
    expect(hits.data.length).toBeGreaterThan(0);
    expect(hits.data.length).toBeLessThan(all.data.length);
  });

  it('finds a record by its reference number', async () => {
    const hits = await incidentService.list(hse, { limit: 50, q: 'INC-2026-0001' } as never);
    expect(hits.data.map((r) => r.reference)).toContain('INC-2026-0001');
  });

  it('returns nothing rather than everything when there is no match', async () => {
    const hits = await incidentService.list(hse, { limit: 50, q: 'zzzznomatchzzz' } as never);
    expect(hits.data).toHaveLength(0);
    expect(hits.meta.hasMore).toBe(false);
  });
});

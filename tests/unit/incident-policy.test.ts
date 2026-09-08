import { describe, expect, it } from 'vitest';
import type { Ctx } from '@/server/auth/context';
import { incidentPolicy, investigationIsMandatory } from '@/server/modules/incidents/policy';

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  userId: 'user-1',
  orgId: '11111111-1111-4111-8111-111111111111',
  role: 'HSE_MANAGER',
  allSites: true,
  siteIds: [],
  requestId: 'req_test',
  ...over,
});

const incident = (over: Record<string, unknown> = {}) =>
  ({
    id: 'inc-1',
    status: 'SUBMITTED',
    site_id: 'site-1',
    reported_by_user_id: 'user-1',
    reported_at: new Date(),
    severity: 'MINOR',
    lost_time: false,
    ...over,
  }) as Parameters<typeof incidentPolicy.assertCanEdit>[1];

describe('investigationIsMandatory', () => {
  it('forces an investigation for major and catastrophic events', () => {
    expect(investigationIsMandatory('MAJOR', false)).toBe(true);
    expect(investigationIsMandatory('CATASTROPHIC', false)).toBe(true);
  });

  it('forces an investigation for any lost-time injury', () => {
    expect(investigationIsMandatory('MINOR', true)).toBe(true);
  });

  it('leaves it optional for low-severity events', () => {
    expect(investigationIsMandatory('MINOR', false)).toBe(false);
    expect(investigationIsMandatory(null, false)).toBe(false);
  });
});

describe('incidentPolicy.assertCanEdit', () => {
  it('lets the author edit inside the 30-minute window', () => {
    expect(() =>
      incidentPolicy.assertCanEdit(ctx({ role: 'EMPLOYEE' }), incident()),
    ).not.toThrow();
  });

  it('closes the author window after 30 minutes', () => {
    const old = incident({ reported_at: new Date(Date.now() - 31 * 60 * 1000) });
    expect(() => incidentPolicy.assertCanEdit(ctx({ role: 'EMPLOYEE' }), old)).toThrow(
      /30-minute edit window/,
    );
  });

  it('still lets HSE edit an old record', () => {
    const old = incident({ reported_at: new Date(Date.now() - 24 * 60 * 60 * 1000) });
    expect(() => incidentPolicy.assertCanEdit(ctx(), old)).not.toThrow();
  });

  it('makes a closed event read-only for everyone', () => {
    expect(() => incidentPolicy.assertCanEdit(ctx(), incident({ status: 'CLOSED' }))).toThrow(
      /read-only/,
    );
  });
});

describe('incidentPolicy.assertCanClose', () => {
  it('refuses to close while actions are open', () => {
    expect(() => incidentPolicy.assertCanClose(ctx(), incident(), 3)).toThrow(/3 action/);
  });

  it('closes when every action is resolved', () => {
    expect(() => incidentPolicy.assertCanClose(ctx(), incident(), 0)).not.toThrow();
  });
});

describe('incidentPolicy.assertCanView', () => {
  it('reports another site as not found rather than forbidden', () => {
    // A 403 would confirm the record exists. docs/04-API-SPEC.md section 1.
    const scoped = ctx({ role: 'SITE_MANAGER', allSites: false, siteIds: ['site-2'] });
    expect(() => incidentPolicy.assertCanView(scoped, incident())).toThrow(/not found/i);
  });

  it("hides another employee's report from an employee", () => {
    const other = ctx({ role: 'EMPLOYEE', userId: 'user-2' });
    expect(() => incidentPolicy.assertCanView(other, incident())).toThrow(/not found/i);
  });
});

describe('sensitive data', () => {
  it('withholds injury detail from an org admin', () => {
    expect(incidentPolicy.canViewSensitive(ctx({ role: 'ORG_ADMIN' }))).toBe(false);
  });

  it('allows it for HSE and investigators', () => {
    expect(incidentPolicy.canViewSensitive(ctx({ role: 'HSE_MANAGER' }))).toBe(true);
    expect(incidentPolicy.canViewSensitive(ctx({ role: 'INVESTIGATOR' }))).toBe(true);
  });

  it("does not give a reporter a colleague's medical detail", () => {
    // The witness who files the report is the case that makes an
    // incident-level rule wrong.
    const reporter = ctx({ role: 'EMPLOYEE', userId: 'witness-1' });
    expect(incidentPolicy.canViewPersonSensitive(reporter, { user_id: 'injured-2' })).toBe(false);
    expect(incidentPolicy.canViewPersonSensitive(reporter, { user_id: null })).toBe(false);
  });

  it('lets a person see their own injury record', () => {
    const subject = ctx({ role: 'EMPLOYEE', userId: 'injured-2' });
    expect(incidentPolicy.canViewPersonSensitive(subject, { user_id: 'injured-2' })).toBe(true);
  });

  it('still lets HSE see every person on the record', () => {
    expect(incidentPolicy.canViewPersonSensitive(ctx(), { user_id: 'anyone' })).toBe(true);
  });
});

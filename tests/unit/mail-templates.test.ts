import { describe, expect, it } from 'vitest';
import { templates } from '@/server/services/mail/templates';

describe('email templates', () => {
  it('puts the reference, the ask and the deadline in an assignment', () => {
    const m = templates.actionAssigned({
      reference: 'ACT-2026-0042',
      title: 'Install a lifeline on the Block C edge',
      dueDate: '2026-09-30',
      actionId: 'a-1',
    });
    expect(m.subject).toContain('ACT-2026-0042');
    for (const s of ['ACT-2026-0042', 'Install a lifeline', '2026-09-30', '/actions/a-1']) {
      expect(m.html, s).toContain(s);
      if (s !== '/actions/a-1') expect(m.text, s).toContain(s);
    }
  });

  it('says "tomorrow" rather than "in 1 days"', () => {
    expect(templates.actionDue({ reference: 'A', title: 't', days: 1, actionId: 'x' }).subject)
      .toContain('tomorrow');
    expect(templates.actionDue({ reference: 'A', title: 't', days: 7, actionId: 'x' }).subject)
      .toContain('in 7 days');
  });

  it('marks an escalation as one', () => {
    const m = templates.actionOverdue({
      reference: 'ACT-1', title: 't', days: 8, actionId: 'x', escalated: true,
    });
    expect(m.subject).toMatch(/^Escalation/);
    expect(m.html).toContain('require your attention');
  });

  it('renders the digest figures', () => {
    const m = templates.weeklyDigest({
      orgName: 'Kilimanjaro Construction Ltd',
      reported: 12, open: 5, overdue: 3, awaitingVerification: 2, closedThisWeek: 4,
    });
    expect(m.subject).toContain('Kilimanjaro Construction Ltd');
    for (const n of ['12', '5', '3', '2', '4']) expect(m.html).toContain(`>${n}</td>`);
  });

  it('never leaves an unsubstituted placeholder in the markup', () => {
    const all = [
      templates.actionAssigned({ reference: 'r', title: 't', dueDate: 'd', actionId: 'a' }),
      templates.actionDue({ reference: 'r', title: 't', days: 3, actionId: 'a' }),
      templates.actionOverdue({ reference: 'r', title: 't', days: 3, actionId: 'a', escalated: false }),
      templates.investigationAssigned({ reference: 'r', title: 't', dueAt: 'd', investigationId: 'i' }),
      templates.weeklyDigest({
        orgName: 'o', reported: 1, open: 1, overdue: 0, awaitingVerification: 0, closedThisWeek: 1,
      }),
    ];
    for (const m of all) {
      expect(m.html).not.toMatch(/\$\{|undefined|\[object Object\]/);
      expect(m.text).not.toMatch(/\$\{|undefined/);
      expect(m.subject.length).toBeGreaterThan(0);
    }
  });
});

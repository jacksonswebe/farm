/**
 * Email templates.
 *
 * Plain, narrow, and readable on a phone — these are read on a site, often in
 * sunlight, by someone who wants to know what is being asked of them and by
 * when. Every message states the ask and links straight to the record.
 */
const BRAND = '#0f766e';

function layout(heading: string, body: string, cta?: { label: string; url: string }): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
<tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
<span style="font-weight:700;color:${BRAND};font-size:16px;">SafeSphere EHS</span>
</td></tr>
<tr><td style="padding:24px;">
<h1 style="margin:0 0 12px;font-size:18px;color:#0f172a;">${heading}</h1>
<div style="font-size:14px;line-height:1.6;color:#334155;">${body}</div>
${cta ? `<p style="margin:24px 0 0;"><a href="${cta.url}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">${cta.label}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
This is a safety notification. Assignment and escalation messages cannot be turned off.
</td></tr>
</table></td></tr></table></body></html>`;
}

const appUrl = () => process.env.APP_URL ?? 'https://app.safesphere.io';

export const templates = {
  actionAssigned(p: { reference: string; title: string; dueDate: string; actionId: string }) {
    const url = `${appUrl()}/actions/${p.actionId}`;
    return {
      subject: `Action assigned to you: ${p.reference}`,
      text: `You have been assigned ${p.reference}: ${p.title}. Due ${p.dueDate}. ${url}`,
      html: layout(
        'A corrective action has been assigned to you',
        `<p style="margin:0 0 8px;"><strong>${p.reference}</strong></p>
         <p style="margin:0 0 8px;">${p.title}</p>
         <p style="margin:0;color:#64748b;">Due <strong>${p.dueDate}</strong></p>`,
        { label: 'Open the action', url },
      ),
    };
  },

  actionDue(p: { reference: string; title: string; days: number; actionId: string }) {
    const url = `${appUrl()}/actions/${p.actionId}`;
    const when = p.days === 1 ? 'tomorrow' : `in ${p.days} days`;
    return {
      subject: `Due ${when}: ${p.reference}`,
      text: `${p.reference} is due ${when}: ${p.title}. ${url}`,
      html: layout(
        `An action you own is due ${when}`,
        `<p style="margin:0 0 8px;"><strong>${p.reference}</strong></p><p style="margin:0;">${p.title}</p>`,
        { label: 'Update progress', url },
      ),
    };
  },

  actionOverdue(p: { reference: string; title: string; days: number; actionId: string; escalated: boolean }) {
    const url = `${appUrl()}/actions/${p.actionId}`;
    return {
      subject: `${p.escalated ? 'Escalation — ' : ''}Overdue ${p.days} day${p.days === 1 ? '' : 's'}: ${p.reference}`,
      text: `${p.reference} is ${p.days} days overdue: ${p.title}. ${url}`,
      html: layout(
        p.escalated
          ? 'An action in your area is overdue and has been escalated'
          : `An action you own is ${p.days} day${p.days === 1 ? '' : 's'} overdue`,
        `<p style="margin:0 0 8px;"><strong>${p.reference}</strong></p>
         <p style="margin:0 0 8px;">${p.title}</p>
         ${p.escalated ? '<p style="margin:0;color:#b91c1c;">This has been outstanding long enough to require your attention.</p>' : ''}`,
        { label: 'Open the action', url },
      ),
    };
  },

  investigationAssigned(p: { reference: string; title: string; dueAt: string; investigationId: string }) {
    const url = `${appUrl()}/investigations/${p.investigationId}`;
    return {
      subject: `Investigation assigned: ${p.reference}`,
      text: `You are the lead investigator for ${p.reference}: ${p.title}. Due ${p.dueAt}. ${url}`,
      html: layout(
        'You have been assigned an investigation',
        `<p style="margin:0 0 8px;"><strong>${p.reference}</strong></p>
         <p style="margin:0 0 8px;">${p.title}</p>
         <p style="margin:0;color:#64748b;">Due <strong>${p.dueAt}</strong></p>`,
        { label: 'Open the workspace', url },
      ),
    };
  },

  weeklyDigest(p: {
    orgName: string;
    reported: number;
    open: number;
    overdue: number;
    awaitingVerification: number;
    closedThisWeek: number;
    narrative?: string | null;
  }) {
    const rows: [string, number][] = [
      ['Events reported this week', p.reported],
      ['Events still open', p.open],
      ['Overdue actions', p.overdue],
      ['Actions awaiting verification', p.awaitingVerification],
      ['Events closed this week', p.closedThisWeek],
    ];
    return {
      subject: `Weekly safety summary — ${p.orgName}`,
      text: rows.map(([l, v]) => `${l}: ${v}`).join('\n'),
      html: layout(
        `Weekly safety summary`,
        `${p.narrative ? `<p style="margin:0 0 16px;">${p.narrative}</p>` : ''}
         <table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;">
         ${rows.map(([l, v]) => `<tr>
            <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;color:#334155;">${l}</td>
            <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;color:${p.overdue > 0 && l === 'Overdue actions' ? '#b91c1c' : '#0f172a'};">${v}</td>
          </tr>`).join('')}
         </table>`,
        { label: 'Open the dashboard', url: `${appUrl()}/dashboard` },
      ),
    };
  },
};

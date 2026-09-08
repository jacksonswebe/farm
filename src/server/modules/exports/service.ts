import type { Ctx } from '@/server/auth/context';
import { requirePermission, siteScopeFilter } from '@/server/auth/context';
import { withTenant } from '@/server/db/tenant';
import { recordAudit } from '@/server/modules/audit/service';
import { incidentPolicy } from '@/server/modules/incidents/policy';

/**
 * CSV export.
 *
 * RFC 4180 quoting, and every field that could begin with =, +, - or @ is
 * prefixed with a single quote. Without that a cell reading
 * =HYPERLINK("http://evil","click") — which a reporter can type into a free
 * text description — executes when the customer opens the file in Excel.
 * This is a real injection path in any product that exports user text.
 */
function csvCell(value: unknown): string {
  if (value == null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  // A UTF-8 BOM, so Excel opens Swahili and accented names correctly rather
  // than as mojibake — the first thing a customer notices.
  return (
    '﻿' +
    [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') +
    '\r\n'
  );
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '');

export const exportService = {
  async incidentsCsv(ctx: Ctx, includeSensitive = false) {
    requirePermission(ctx, 'report.export');
    const canSeeSensitive = includeSensitive && incidentPolicy.canViewSensitive(ctx);

    return withTenant(ctx.orgId, async (tx) => {
      const rows = await tx.incidents.findMany({
        where: {
          ...siteScopeFilter(ctx),
          status: { notIn: ['DRAFT'] },
        },
        orderBy: { occurred_at: 'desc' },
        take: 50_000,
        select: {
          reference: true, report_type: true, status: true, title: true, description: true,
          severity: true, likelihood: true, risk_score: true, risk_band: true,
          work_area: true, occurred_at: true, reported_at: true, acknowledged_at: true,
          closed_at: true, lost_time: true, reportable_to_authority: true,
          is_anonymous: true, source: true,
          sites: { select: { name: true } },
          departments: { select: { name: true } },
          users_incidents_reported_by_user_idTousers: { select: { full_name: true } },
        },
      });

      await recordAudit(tx, ctx, {
        action: 'EXPORT',
        entity: 'INCIDENT',
        metadata: { format: 'csv', rows: rows.length, includeSensitive: canSeeSensitive },
      });

      return toCsv(
        ['Reference', 'Type', 'Status', 'Title', 'Description', 'Severity', 'Likelihood',
         'Risk score', 'Risk band', 'Site', 'Department', 'Work area', 'Occurred at',
         'Reported at', 'Acknowledged at', 'Closed at', 'Lost time',
         'Reportable to authority', 'Source', 'Reported by'],
        rows.map((r) => [
          r.reference, r.report_type, r.status, r.title, r.description, r.severity, r.likelihood,
          r.risk_score, r.risk_band, r.sites.name, r.departments?.name, r.work_area,
          iso(r.occurred_at), iso(r.reported_at), iso(r.acknowledged_at), iso(r.closed_at),
          r.lost_time ? 'yes' : 'no', r.reportable_to_authority ? 'yes' : 'no', r.source,
          r.is_anonymous ? 'Anonymous' : (r.users_incidents_reported_by_user_idTousers?.full_name ?? ''),
        ]),
      );
    });
  },

  async actionsCsv(ctx: Ctx) {
    requirePermission(ctx, 'report.export');

    return withTenant(ctx.orgId, async (tx) => {
      const rows = await tx.actions.findMany({
        where: ctx.allSites ? {} : siteScopeFilter(ctx),
        orderBy: { due_date: 'asc' },
        take: 50_000,
        select: {
          reference: true, title: true, description: true, action_type: true, status: true,
          priority: true, hierarchy_level: true, original_due_date: true, due_date: true,
          verified_at: true, effectiveness: true, verification_comments: true,
          users_actions_owner_user_idTousers: { select: { full_name: true } },
          users_actions_verifier_user_idTousers: { select: { full_name: true } },
          incidents: { select: { reference: true } },
          sites: { select: { name: true } },
        },
      });

      await recordAudit(tx, ctx, {
        action: 'EXPORT',
        entity: 'ACTION',
        metadata: { format: 'csv', rows: rows.length },
      });

      const today = new Date().toISOString().slice(0, 10);
      return toCsv(
        ['Reference', 'Title', 'Description', 'Type', 'Status', 'Priority',
         'Hierarchy of control', 'Owner', 'Verifier', 'Original due date', 'Due date',
         'Extended', 'Overdue', 'Verified at', 'Effectiveness', 'Verification comments',
         'Source event', 'Site'],
        rows.map((r) => {
          const orig = r.original_due_date.toISOString().slice(0, 10);
          const due = r.due_date.toISOString().slice(0, 10);
          const open = ['OPEN', 'IN_PROGRESS', 'REJECTED'].includes(r.status);
          return [
            r.reference, r.title, r.description, r.action_type, r.status, r.priority,
            r.hierarchy_level,
            r.users_actions_owner_user_idTousers?.full_name,
            r.users_actions_verifier_user_idTousers?.full_name,
            orig, due,
            orig !== due ? 'yes' : 'no',
            open && due < today ? 'yes' : 'no',
            iso(r.verified_at), r.effectiveness, r.verification_comments,
            r.incidents?.reference, r.sites?.name,
          ];
        }),
      );
    });
  },
};

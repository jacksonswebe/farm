import type { Ctx } from '@/server/auth/context';
import { requirePermission, siteScopeFilter } from '@/server/auth/context';
import { withTenant } from '@/server/db/tenant';
import { recordAudit } from '@/server/modules/audit/service';
import { incidentPolicy } from '@/server/modules/incidents/policy';
import { investigationPolicy } from '@/server/modules/investigations/policy';
import { renderEvidencePack, type EvidencePackData } from '@/server/services/pdf/evidence-pack';
import { notFound } from '@/server/lib/errors';

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
  /**
   * The incident evidence pack — the artifact an auditor, insurer or lawyer is
   * handed. Assembled under the caller's own permissions, so the pack a site
   * manager exports withholds the injury and interview detail that the HSE
   * manager's copy contains, and says on its face that it has done so. A pack
   * that silently omitted material would be worse than one that refuses.
   *
   * Producing it is itself an audit event: customers are asked who saw what.
   */
  async incidentEvidencePack(ctx: Ctx, incidentId: string): Promise<{ pdf: Buffer; reference: string }> {
    requirePermission(ctx, 'report.export');

    const data = await withTenant(ctx.orgId, async (tx) => {
      const incident = await tx.incidents.findUnique({
        where: { id: incidentId },
        include: {
          sites: { select: { name: true } },
          departments: { select: { name: true } },
          users_incidents_reported_by_user_idTousers: { select: { full_name: true } },
          incident_persons: true,
        },
      });
      if (!incident) throw notFound('Event');
      incidentPolicy.assertCanView(ctx, incident);

      const org = await tx.organizations.findFirst({ select: { name: true } });
      const me = await tx.users.findUnique({
        where: { id: ctx.userId },
        select: { full_name: true },
      });

      const investigation = await tx.investigations.findUnique({
        where: { incident_id: incidentId },
        include: {
          users_investigations_lead_investigator_idTousers: { select: { full_name: true } },
          users_investigations_approved_by_user_idTousers: { select: { full_name: true } },
          investigation_timeline_entries: { orderBy: { occurred_at: 'asc' } },
          investigation_interviews: { orderBy: { interviewed_at: 'asc' } },
          findings: { orderBy: [{ finding_type: 'asc' }, { sort_order: 'asc' }] },
          root_causes: { include: { root_cause_whys: { orderBy: { step: 'asc' } } } },
        },
      });

      const actions = await tx.actions.findMany({
        where: { incident_id: incidentId },
        orderBy: { created_at: 'asc' },
        include: {
          users_actions_owner_user_idTousers: { select: { full_name: true } },
          users_actions_verifier_user_idTousers: { select: { full_name: true } },
        },
      });

      const attachments = await tx.attachments.findMany({
        where: { entity: 'INCIDENT', entity_id: incidentId, deleted_at: null, upload_status: 'UPLOADED' },
        orderBy: { created_at: 'asc' },
        select: { file_name: true, mime_type: true, size_bytes: true, created_at: true, is_sensitive: true },
      });

      const audit = await tx.audit_events.findMany({
        where: { entity: 'INCIDENT', entity_id: incidentId },
        orderBy: { created_at: 'asc' },
        take: 200,
        select: { created_at: true, action: true, actor_label: true, changes: true, actor_user_id: true },
      });
      const actorIds = [...new Set(audit.map((a) => a.actor_user_id).filter((x): x is string => !!x))];
      const actors = actorIds.length
        ? await tx.users.findMany({ where: { id: { in: actorIds } }, select: { id: true, full_name: true } })
        : [];
      const actorName = new Map(actors.map((a) => [a.id, a.full_name]));

      const canSeeSensitive = incidentPolicy.canViewSensitive(ctx);
      const canSeeInterviews =
        ctx.role === 'HSE_MANAGER' ||
        (investigation ? investigationPolicy.isOnTeam(ctx, investigation) : false);

      const pack: EvidencePackData = {
        orgName: org?.name ?? 'Organization',
        generatedAt: new Date(),
        generatedBy: me?.full_name ?? 'Unknown user',
        incident: {
          reference: incident.reference,
          report_type: incident.report_type,
          status: incident.status,
          title: incident.title,
          description: incident.description,
          immediate_action: incident.immediate_action,
          work_area: incident.work_area,
          severity: incident.severity,
          likelihood: incident.likelihood,
          risk_score: incident.risk_score,
          risk_band: incident.risk_band,
          occurred_at: incident.occurred_at,
          reported_at: incident.reported_at,
          acknowledged_at: incident.acknowledged_at,
          closed_at: incident.closed_at,
          closure_statement: incident.closure_statement,
          lessons_learned: incident.lessons_learned,
          lost_time: incident.lost_time,
          reportable_to_authority: incident.reportable_to_authority,
          is_anonymous: incident.is_anonymous,
          source: incident.source,
          siteName: incident.sites.name,
          departmentName: incident.departments?.name ?? null,
          reporterName: incident.users_incidents_reported_by_user_idTousers?.full_name ?? null,
        },
        persons: incident.incident_persons.map((p) => {
          const redact = p.is_sensitive && !incidentPolicy.canViewPersonSensitive(ctx, p);
          return {
            full_name: p.full_name,
            involvement: p.involvement,
            treatment: redact ? null : p.treatment,
            days_lost: redact ? null : p.days_lost,
            statement: redact ? null : p.statement,
            redacted: redact,
          };
        }),
        investigation: investigation
          ? {
              status: investigation.status,
              leadName:
                investigation.users_investigations_lead_investigator_idTousers?.full_name ?? null,
              assigned_at: investigation.assigned_at,
              due_at: investigation.due_at,
              submitted_at: investigation.submitted_at,
              approved_at: investigation.approved_at,
              approverName:
                investigation.users_investigations_approved_by_user_idTousers?.full_name ?? null,
              summary: investigation.summary,
              timeline: investigation.investigation_timeline_entries.map((t) => ({
                occurred_at: t.occurred_at,
                description: t.description,
              })),
              interviews: investigation.investigation_interviews.map((iv) => {
                const withheld = iv.is_sensitive && !canSeeInterviews;
                return {
                  name: iv.interviewee_name,
                  interviewed_at: iv.interviewed_at,
                  notes: withheld
                    ? 'Withheld — this interview is marked sensitive and is not included in an export at your permission level.'
                    : iv.notes,
                  withheld,
                };
              }),
              findings: investigation.findings.map((f) => ({
                finding_type: f.finding_type,
                statement: f.statement,
              })),
              rootCauses: investigation.root_causes.map((rc) => ({
                statement: rc.statement,
                category: rc.category,
                problem_statement: rc.problem_statement,
                whys: rc.root_cause_whys.map((w) => ({
                  step: w.step,
                  question: w.question,
                  answer: w.answer,
                })),
              })),
            }
          : null,
        actions: actions.map((a) => ({
          reference: a.reference,
          title: a.title,
          action_type: a.action_type,
          hierarchy_level: a.hierarchy_level,
          status: a.status,
          ownerName: a.users_actions_owner_user_idTousers?.full_name ?? null,
          verifierName: a.users_actions_verifier_user_idTousers?.full_name ?? null,
          original_due_date: a.original_due_date,
          due_date: a.due_date,
          verified_at: a.verified_at,
          effectiveness: a.effectiveness,
          verification_comments: a.verification_comments,
        })),
        attachments: attachments
          .filter((f) => canSeeSensitive || !f.is_sensitive)
          .map((f) => ({
            file_name: f.file_name,
            mime_type: f.mime_type,
            size_bytes: Number(f.size_bytes),
            created_at: f.created_at,
          })),
        audit: audit.map((e) => ({
          created_at: e.created_at,
          action: e.action,
          actor: e.actor_user_id ? (actorName.get(e.actor_user_id) ?? e.actor_label) : e.actor_label,
          changes: e.changes,
        })),
      };

      await recordAudit(tx, ctx, {
        action: 'EXPORT',
        entity: 'INCIDENT',
        entityId: incidentId,
        entityReference: incident.reference,
        metadata: { format: 'pdf', scope: 'evidence-pack', redacted: !canSeeSensitive },
      });

      return pack;
    });

    return { pdf: await renderEvidencePack(data), reference: data.incident.reference };
  },

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

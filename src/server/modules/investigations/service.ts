import type { Ctx } from '@/server/auth/context';
import { requirePermission } from '@/server/auth/context';
import { withTenant, type TenantTx } from '@/server/db/tenant';
import { notFound, invalidState } from '@/server/lib/errors';
import { recordAudit } from '@/server/modules/audit/service';
import {
  defaultInvestigationDueAt,
  detectBlame,
  investigationPolicy,
} from './policy';
import type {
  AssignInvestigationInput,
  FindingInput,
  InterviewInput,
  RootCauseInput,
  TimelineEntryInput,
  WhysInput,
} from './schema';

async function loadForEdit(tx: TenantTx, ctx: Ctx, id: string) {
  const inv = await tx.investigations.findUnique({ where: { id } });
  if (!inv) throw notFound('Investigation');
  investigationPolicy.assertCanEdit(ctx, inv);
  return inv;
}

export const investigationService = {
  /** Opens an investigation on an incident and moves it to INVESTIGATING. */
  async assign(ctx: Ctx, incidentId: string, input: AssignInvestigationInput) {
    requirePermission(ctx, 'investigation.assign');

    return withTenant(ctx.orgId, async (tx) => {
      const incident = await tx.incidents.findUnique({ where: { id: incidentId } });
      if (!incident) throw notFound('Event');
      if (incident.status === 'CLOSED') throw invalidState('This event is closed.');

      const existing = await tx.investigations.findUnique({
        where: { incident_id: incidentId },
        select: { id: true },
      });
      if (existing) throw invalidState('This event already has an investigation.');

      // Confirm the investigator is a real, active member of this org before
      // assigning work to them.
      const lead = await tx.memberships.findFirst({
        where: { user_id: input.leadInvestigatorId, is_active: true },
        select: { user_id: true },
      });
      if (!lead) throw notFound('Investigator');

      const dueAt = input.dueAt ?? defaultInvestigationDueAt(incident.severity);

      const investigation = await tx.investigations.create({
        data: {
          organization_id: ctx.orgId,
          incident_id: incidentId,
          status: 'ASSIGNED',
          lead_investigator_id: input.leadInvestigatorId,
          team_user_ids: input.teamUserIds,
          assigned_by_user_id: ctx.userId,
          due_at: dueAt,
        },
      });

      await tx.incidents.update({
        where: { id: incidentId },
        data: { status: 'INVESTIGATING', investigation_required: true },
      });

      await tx.notifications.create({
        data: {
          organization_id: ctx.orgId,
          recipient_user_id: input.leadInvestigatorId,
          category: 'INVESTIGATION_ASSIGNED',
          title: `Investigation assigned: ${incident.reference}`,
          body: incident.title ?? incident.description.slice(0, 200),
          entity: 'INVESTIGATION',
          entity_id: investigation.id,
          deep_link: `/investigations/${investigation.id}`,
        },
      });

      await recordAudit(tx, ctx, {
        action: 'ASSIGN',
        entity: 'INVESTIGATION',
        entityId: investigation.id,
        entityReference: incident.reference,
        changes: { lead_investigator: { from: null, to: input.leadInvestigatorId } },
      });

      return investigation;
    });
  },

  async getById(ctx: Ctx, id: string) {
    return withTenant(ctx.orgId, async (tx) => {
      const inv = await tx.investigations.findUnique({
        where: { id },
        include: {
          incidents: {
            select: {
              id: true, reference: true, title: true, description: true,
              severity: true, status: true, occurred_at: true,
              sites: { select: { name: true } },
            },
          },
          users_investigations_lead_investigator_idTousers: {
            select: { id: true, full_name: true },
          },
          investigation_timeline_entries: { orderBy: { occurred_at: 'asc' } },
          investigation_interviews: { orderBy: { interviewed_at: 'asc' } },
          findings: { orderBy: [{ finding_type: 'asc' }, { sort_order: 'asc' }] },
          root_causes: { include: { root_cause_whys: { orderBy: { step: 'asc' } } } },
        },
      });
      if (!inv) throw notFound('Investigation');
      investigationPolicy.assertCanView(ctx, inv);

      // An interview marked sensitive — a statement about a colleague, a
      // medical detail volunteered in the room — is readable by HSE and the
      // investigation team only. Everyone else sees that it happened, not
      // what was said. Filtered here rather than in the page so a future
      // endpoint cannot expose it by omission.
      const canReadSensitive =
        ctx.role === 'HSE_MANAGER' || investigationPolicy.isOnTeam(ctx, inv);
      const interviews = inv.investigation_interviews.map((i) =>
        i.is_sensitive && !canReadSensitive
          ? { ...i, notes: '[Withheld — this interview is marked sensitive.]' }
          : i,
      );

      const actions = await tx.actions.findMany({
        where: { investigation_id: id },
        select: {
          id: true, reference: true, title: true, status: true,
          action_type: true, hierarchy_level: true, due_date: true,
          users_actions_owner_user_idTousers: { select: { full_name: true } },
        },
        orderBy: { created_at: 'asc' },
      });

      return { ...inv, investigation_interviews: interviews, actions };
    });
  },

  async listOpen(ctx: Ctx) {
    requirePermission(ctx, 'investigation.view');
    return withTenant(ctx.orgId, async (tx) => {
      const rows = await tx.investigations.findMany({
        where: {
          status: { in: ['ASSIGNED', 'IN_PROGRESS', 'RETURNED', 'SUBMITTED'] },
          ...(ctx.role === 'INVESTIGATOR' ? { lead_investigator_id: ctx.userId } : {}),
        },
        orderBy: { due_at: 'asc' },
        select: {
          id: true, status: true, due_at: true,
          incidents: { select: { reference: true, title: true, severity: true } },
          users_investigations_lead_investigator_idTousers: { select: { full_name: true } },
        },
      });
      const now = Date.now();
      return rows.map((r) => ({
        id: r.id,
        status: r.status,
        dueAt: r.due_at,
        isOverdue: r.due_at.getTime() < now && r.status !== 'SUBMITTED',
        reference: r.incidents.reference,
        title: r.incidents.title,
        severity: r.incidents.severity,
        lead: r.users_investigations_lead_investigator_idTousers?.full_name ?? null,
      }));
    });
  },

  /** First edit moves ASSIGNED → IN_PROGRESS so the dashboard reflects reality. */
  async markStarted(tx: TenantTx, ctx: Ctx, id: string, status: string) {
    if (status === 'ASSIGNED') {
      await tx.investigations.update({
        where: { id },
        data: { status: 'IN_PROGRESS', started_at: new Date() },
      });
      await recordAudit(tx, ctx, {
        action: 'STATUS_CHANGE',
        entity: 'INVESTIGATION',
        entityId: id,
        changes: { status: { from: 'ASSIGNED', to: 'IN_PROGRESS' } },
      });
    }
  },

  async addTimelineEntry(ctx: Ctx, id: string, input: TimelineEntryInput) {
    return withTenant(ctx.orgId, async (tx) => {
      const inv = await loadForEdit(tx, ctx, id);
      await this.markStarted(tx, ctx, id, inv.status);
      return tx.investigation_timeline_entries.create({
        data: {
          organization_id: ctx.orgId,
          investigation_id: id,
          occurred_at: input.occurredAt,
          description: input.description,
          sort_order: input.sortOrder ?? 0,
          created_by_user_id: ctx.userId,
        },
      });
    });
  },

  async addInterview(ctx: Ctx, id: string, input: InterviewInput) {
    return withTenant(ctx.orgId, async (tx) => {
      const inv = await loadForEdit(tx, ctx, id);
      await this.markStarted(tx, ctx, id, inv.status);
      return tx.investigation_interviews.create({
        data: {
          organization_id: ctx.orgId,
          investigation_id: id,
          interviewee_user_id: input.intervieweeUserId ?? null,
          interviewee_name: input.intervieweeName ?? null,
          interviewed_at: input.interviewedAt,
          notes: input.notes,
          is_sensitive: input.isSensitive,
          created_by_user_id: ctx.userId,
        },
      });
    });
  },

  async addFinding(ctx: Ctx, id: string, input: FindingInput) {
    return withTenant(ctx.orgId, async (tx) => {
      const inv = await loadForEdit(tx, ctx, id);
      await this.markStarted(tx, ctx, id, inv.status);
      const count = await tx.findings.count({ where: { investigation_id: id } });
      return tx.findings.create({
        data: {
          organization_id: ctx.orgId,
          investigation_id: id,
          finding_type: input.findingType,
          statement: input.statement,
          evidence_note: input.evidenceNote ?? null,
          sort_order: count,
          created_by_user_id: ctx.userId,
        },
      });
    });
  },

  async addRootCause(ctx: Ctx, id: string, input: RootCauseInput) {
    return withTenant(ctx.orgId, async (tx) => {
      const inv = await loadForEdit(tx, ctx, id);
      await this.markStarted(tx, ctx, id, inv.status);

      const rootCause = await tx.root_causes.create({
        data: {
          organization_id: ctx.orgId,
          investigation_id: id,
          problem_statement: input.problemStatement,
          statement: input.statement,
          category: input.category,
          is_systemic: input.category !== 'PEOPLE',
          created_by_user_id: ctx.userId,
        },
      });

      // Advisory only — recorded, never blocked.
      return { ...rootCause, blameWarning: detectBlame(input.statement) };
    });
  },

  /** Replaces the whole chain atomically — a partial 5 Whys is not a 5 Whys. */
  async replaceWhys(ctx: Ctx, rootCauseId: string, input: WhysInput) {
    return withTenant(ctx.orgId, async (tx) => {
      const rootCause = await tx.root_causes.findUnique({ where: { id: rootCauseId } });
      if (!rootCause) throw notFound('Root cause');
      await loadForEdit(tx, ctx, rootCause.investigation_id);

      await tx.root_cause_whys.deleteMany({ where: { root_cause_id: rootCauseId } });
      await tx.root_cause_whys.createMany({
        data: input.steps.map((s) => ({
          organization_id: ctx.orgId,
          root_cause_id: rootCauseId,
          step: s.step,
          question: s.question,
          answer: s.answer,
          ai_suggested: s.aiSuggested,
        })),
      });

      return tx.root_cause_whys.findMany({
        where: { root_cause_id: rootCauseId },
        orderBy: { step: 'asc' },
      });
    });
  },

  async submit(ctx: Ctx, id: string) {
    return withTenant(ctx.orgId, async (tx) => {
      const inv = await tx.investigations.findUnique({ where: { id } });
      if (!inv) throw notFound('Investigation');

      const [findings, rootCauses, actions] = await Promise.all([
        tx.findings.count({ where: { investigation_id: id } }),
        tx.root_causes.count({ where: { investigation_id: id } }),
        tx.actions.count({ where: { investigation_id: id } }),
      ]);
      investigationPolicy.assertCanSubmit(ctx, inv, { findings, rootCauses, actions });

      const updated = await tx.investigations.update({
        where: { id },
        data: { status: 'SUBMITTED', submitted_at: new Date() },
      });

      const approvers = await tx.memberships.findMany({
        where: { role: 'HSE_MANAGER', is_active: true },
        select: { user_id: true },
      });
      const incident = await tx.incidents.findUnique({
        where: { id: inv.incident_id },
        select: { reference: true },
      });
      if (approvers.length > 0) {
        await tx.notifications.createMany({
          data: approvers.map((a) => ({
            organization_id: ctx.orgId,
            recipient_user_id: a.user_id,
            category: 'INVESTIGATION_SUBMITTED' as const,
            title: `Investigation ready for approval: ${incident?.reference ?? ''}`,
            body: 'An investigation has been submitted and is awaiting your review.',
            entity: 'INVESTIGATION' as const,
            entity_id: id,
            deep_link: `/investigations/${id}`,
          })),
        });
      }

      await recordAudit(tx, ctx, {
        action: 'STATUS_CHANGE',
        entity: 'INVESTIGATION',
        entityId: id,
        entityReference: incident?.reference,
        changes: { status: { from: inv.status, to: 'SUBMITTED' } },
      });

      return updated;
    });
  },

  async approve(ctx: Ctx, id: string) {
    return withTenant(ctx.orgId, async (tx) => {
      const inv = await tx.investigations.findUnique({ where: { id } });
      if (!inv) throw notFound('Investigation');
      investigationPolicy.assertCanDecide(ctx, inv);

      const updated = await tx.investigations.update({
        where: { id },
        data: { status: 'APPROVED', approved_at: new Date(), approved_by_user_id: ctx.userId },
      });

      // The incident advances only once the causes are agreed.
      const incident = await tx.incidents.update({
        where: { id: inv.incident_id },
        data: { status: 'ACTIONS_PENDING' },
      });

      await tx.notifications.create({
        data: {
          organization_id: ctx.orgId,
          recipient_user_id: inv.lead_investigator_id,
          category: 'INVESTIGATION_SUBMITTED',
          title: `Investigation approved: ${incident.reference}`,
          body: 'Your investigation has been approved.',
          entity: 'INVESTIGATION',
          entity_id: id,
          deep_link: `/investigations/${id}`,
        },
      });

      await recordAudit(tx, ctx, {
        action: 'APPROVE',
        entity: 'INVESTIGATION',
        entityId: id,
        entityReference: incident.reference,
        changes: { status: { from: 'SUBMITTED', to: 'APPROVED' } },
      });

      return updated;
    });
  },

  async returnForRework(ctx: Ctx, id: string, comments: string) {
    return withTenant(ctx.orgId, async (tx) => {
      const inv = await tx.investigations.findUnique({ where: { id } });
      if (!inv) throw notFound('Investigation');
      investigationPolicy.assertCanDecide(ctx, inv);

      const updated = await tx.investigations.update({
        where: { id },
        data: { status: 'RETURNED', returned_at: new Date(), return_comments: comments },
      });

      await tx.notifications.create({
        data: {
          organization_id: ctx.orgId,
          recipient_user_id: inv.lead_investigator_id,
          category: 'INVESTIGATION_RETURNED',
          title: 'Investigation returned for rework',
          body: comments,
          entity: 'INVESTIGATION',
          entity_id: id,
          deep_link: `/investigations/${id}`,
        },
      });

      await recordAudit(tx, ctx, {
        action: 'REJECT',
        entity: 'INVESTIGATION',
        entityId: id,
        changes: { status: { from: 'SUBMITTED', to: 'RETURNED' } },
      });

      return updated;
    });
  },
};

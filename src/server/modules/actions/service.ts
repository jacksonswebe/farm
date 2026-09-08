import type { Prisma, action_status } from '@prisma/client';
import type { Ctx } from '@/server/auth/context';
import { requirePermission, siteScopeFilter } from '@/server/auth/context';
import { withTenant, type TenantTx } from '@/server/db/tenant';
import { notFound, invalidState } from '@/server/lib/errors';
import { recordAudit } from '@/server/modules/audit/service';
import { actionPolicy, evidenceRequiredFor, isOverdue } from './policy';
import type {
  CreateActionInput,
  ListActionsInput,
  RequestExtensionInput,
  VerifyActionInput,
} from './schema';

const OPEN_STATUSES: action_status[] = ['OPEN', 'IN_PROGRESS', 'REJECTED'];

async function nextReference(tx: TenantTx, orgId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ r: string }[]>`
    SELECT app.next_reference(${orgId}::uuid, 'ACT') AS r`;
  const ref = rows[0]?.r;
  if (!ref) throw new Error('Reference generation returned no value.');
  return ref;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ c: createdAt.toISOString(), i: id })).toString('base64url');
}
function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      c?: string; i?: string;
    };
    return raw.c && raw.i ? { createdAt: new Date(raw.c), id: raw.i } : null;
  } catch {
    return null;
  }
}

/** Severity of the event an action came from — drives the evidence rule. */
async function sourceSeverity(tx: TenantTx, incidentId: string | null) {
  if (!incidentId) return null;
  const incident = await tx.incidents.findUnique({
    where: { id: incidentId },
    select: { severity: true },
  });
  return incident?.severity ?? null;
}

export const actionService = {
  async create(ctx: Ctx, input: CreateActionInput) {
    requirePermission(ctx, 'action.create');

    return withTenant(ctx.orgId, async (tx) => {
      const owner = await tx.memberships.findFirst({
        where: { user_id: input.ownerUserId, is_active: true },
        select: { user_id: true },
      });
      if (!owner) throw notFound('Action owner');

      // Caught here with a clear message rather than as a database constraint
      // violation the user cannot read.
      if (input.verifierUserId && input.verifierUserId === input.ownerUserId) {
        throw invalidState('The verifier must be someone other than the owner.');
      }

      // Derive the incident from whichever parent was supplied, so an action
      // created from a finding still links back to its event.
      let incidentId = input.incidentId ?? null;
      let investigationId = input.investigationId ?? null;
      if (input.findingId && !investigationId) {
        const finding = await tx.findings.findUnique({
          where: { id: input.findingId },
          select: { investigation_id: true },
        });
        investigationId = finding?.investigation_id ?? null;
      }
      if (investigationId && !incidentId) {
        const inv = await tx.investigations.findUnique({
          where: { id: investigationId },
          select: { incident_id: true },
        });
        incidentId = inv?.incident_id ?? null;
      }

      const severity = await sourceSeverity(tx, incidentId);
      const reference = await nextReference(tx, ctx.orgId);
      const dueDate = new Date(input.dueDate.toISOString().slice(0, 10));

      const action = await tx.actions.create({
        data: {
          organization_id: ctx.orgId,
          reference,
          title: input.title,
          description: input.description ?? null,
          action_type: input.actionType,
          status: 'OPEN',
          priority: input.priority,
          hierarchy_level: input.hierarchyLevel,
          incident_id: incidentId,
          investigation_id: investigationId,
          finding_id: input.findingId ?? null,
          root_cause_id: input.rootCauseId ?? null,
          site_id: input.siteId ?? null,
          owner_user_id: input.ownerUserId,
          verifier_user_id: input.verifierUserId ?? null,
          created_by_user_id: ctx.userId,
          original_due_date: dueDate,
          due_date: dueDate,
          evidence_required: evidenceRequiredFor(severity),
        },
      });

      await tx.notifications.create({
        data: {
          organization_id: ctx.orgId,
          recipient_user_id: input.ownerUserId,
          category: 'ACTION_ASSIGNED',
          title: `Action assigned: ${reference}`,
          body: input.title,
          entity: 'ACTION',
          entity_id: action.id,
          deep_link: `/actions/${action.id}`,
        },
      });

      await recordAudit(tx, ctx, {
        action: 'CREATE',
        entity: 'ACTION',
        entityId: action.id,
        entityReference: reference,
        changes: { owner: { from: null, to: input.ownerUserId } },
      });

      return action;
    });
  },

  async list(ctx: Ctx, input: ListActionsInput) {
    requirePermission(ctx, 'action.view');

    return withTenant(ctx.orgId, async (tx) => {
      const cursor = input.cursor ? decodeCursor(input.cursor) : null;
      const ownerId = input.owner === 'me' ? ctx.userId : input.owner;
      const restricted = ctx.role === 'EMPLOYEE' || ctx.role === 'ACTION_OWNER';

      const where: Prisma.actionsWhereInput = {
        ...(ownerId ? { owner_user_id: ownerId } : {}),
        ...(input.incidentId ? { incident_id: input.incidentId } : {}),
        ...(input.site ? { site_id: input.site } : {}),
        ...(input.status
          ? { status: { in: input.status.split(',').map((s) => s.trim()) as action_status[] } }
          : {}),
        ...(input.overdue
          ? { status: { in: OPEN_STATUSES }, due_date: { lt: new Date() } }
          : {}),
        ...(input.dueBefore ? { due_date: { lte: input.dueBefore } } : {}),
        // Employees and action owners see only what they own or verify.
        ...(restricted
          ? { OR: [{ owner_user_id: ctx.userId }, { verifier_user_id: ctx.userId }] }
          : {}),
        ...(!restricted && !ctx.allSites
          ? { OR: [siteScopeFilter(ctx), { owner_user_id: ctx.userId }] }
          : {}),
        ...(cursor
          ? {
              OR: [
                { created_at: { lt: cursor.createdAt } },
                { created_at: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      };

      const rows = await tx.actions.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
        select: {
          id: true, reference: true, title: true, status: true, priority: true,
          action_type: true, hierarchy_level: true, due_date: true, created_at: true,
          effectiveness: true,
          users_actions_owner_user_idTousers: { select: { id: true, full_name: true } },
          incidents: { select: { id: true, reference: true } },
        },
      });

      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;
      const last = page[page.length - 1];

      return {
        data: page.map((a) => ({
          id: a.id,
          reference: a.reference,
          title: a.title,
          status: a.status,
          priority: a.priority,
          actionType: a.action_type,
          hierarchyLevel: a.hierarchy_level,
          dueDate: a.due_date,
          isOverdue: isOverdue({ status: a.status, due_date: a.due_date }),
          effectiveness: a.effectiveness,
          ownerName: a.users_actions_owner_user_idTousers?.full_name ?? null,
          incidentReference: a.incidents?.reference ?? null,
        })),
        meta: { nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null, hasMore },
      };
    });
  },

  async getById(ctx: Ctx, id: string) {
    requirePermission(ctx, 'action.view');
    return withTenant(ctx.orgId, async (tx) => {
      const action = await tx.actions.findUnique({
        where: { id },
        include: {
          users_actions_owner_user_idTousers: { select: { id: true, full_name: true } },
          users_actions_verifier_user_idTousers: { select: { id: true, full_name: true } },
          incidents: { select: { id: true, reference: true, title: true, severity: true } },
          action_updates: {
            orderBy: { created_at: 'desc' },
            include: { users: { select: { full_name: true } } },
          },
          action_extensions: { orderBy: { created_at: 'desc' } },
        },
      });
      if (!action) throw notFound('Action');
      actionPolicy.assertCanView(ctx, action);

      const evidence = await tx.attachments.findMany({
        where: { entity: 'ACTION', entity_id: id, deleted_at: null, upload_status: 'UPLOADED' },
        select: { id: true, file_name: true, mime_type: true, size_bytes: true, created_at: true },
      });

      return {
        ...action,
        evidence,
        isOverdue: isOverdue(action),
        canVerify:
          action.status === 'PENDING_VERIFICATION' && action.owner_user_id !== ctx.userId,
      };
    });
  },

  async start(ctx: Ctx, id: string) {
    return withTenant(ctx.orgId, async (tx) => {
      const action = await tx.actions.findUnique({ where: { id } });
      if (!action) throw notFound('Action');
      actionPolicy.assertCanUpdateProgress(ctx, action);
      if (action.status === 'IN_PROGRESS') return action;

      const updated = await tx.actions.update({
        where: { id },
        data: { status: 'IN_PROGRESS', started_at: action.started_at ?? new Date() },
      });
      await tx.action_updates.create({
        data: {
          organization_id: ctx.orgId,
          action_id: id,
          user_id: ctx.userId,
          note: 'Work started.',
          status_from: action.status,
          status_to: 'IN_PROGRESS',
        },
      });
      return updated;
    });
  },

  async addProgress(ctx: Ctx, id: string, note: string, progressPercent?: number) {
    return withTenant(ctx.orgId, async (tx) => {
      const action = await tx.actions.findUnique({ where: { id } });
      if (!action) throw notFound('Action');
      actionPolicy.assertCanUpdateProgress(ctx, action);

      if (action.status === 'OPEN') {
        await tx.actions.update({
          where: { id },
          data: { status: 'IN_PROGRESS', started_at: action.started_at ?? new Date() },
        });
      }

      return tx.action_updates.create({
        data: {
          organization_id: ctx.orgId,
          action_id: id,
          user_id: ctx.userId,
          note,
          progress_percent: progressPercent ?? null,
        },
      });
    });
  },

  async submitForVerification(ctx: Ctx, id: string, evidenceIds: string[], note?: string) {
    return withTenant(ctx.orgId, async (tx) => {
      const action = await tx.actions.findUnique({ where: { id } });
      if (!action) throw notFound('Action');

      if (evidenceIds.length > 0) {
        await tx.attachments.updateMany({
          where: { id: { in: evidenceIds } },
          data: { entity: 'ACTION', entity_id: id, is_evidence: true },
        });
      }
      const evidenceCount = await tx.attachments.count({
        where: { entity: 'ACTION', entity_id: id, deleted_at: null },
      });

      actionPolicy.assertCanSubmit(ctx, action, evidenceCount, action.evidence_required);

      const updated = await tx.actions.update({
        where: { id },
        data: { status: 'PENDING_VERIFICATION', submitted_at: new Date() },
      });

      await tx.action_updates.create({
        data: {
          organization_id: ctx.orgId,
          action_id: id,
          user_id: ctx.userId,
          note: note ?? 'Submitted for verification.',
          status_from: action.status,
          status_to: 'PENDING_VERIFICATION',
        },
      });

      // Route to the named verifier, or to HSE if none was set.
      const recipients = action.verifier_user_id
        ? [action.verifier_user_id]
        : (
            await tx.memberships.findMany({
              where: { role: 'HSE_MANAGER', is_active: true },
              select: { user_id: true },
            })
          ).map((m) => m.user_id);

      if (recipients.length > 0) {
        await tx.notifications.createMany({
          data: recipients.map((userId) => ({
            organization_id: ctx.orgId,
            recipient_user_id: userId,
            category: 'ACTION_VERIFICATION' as const,
            title: `Verification needed: ${action.reference}`,
            body: action.title,
            entity: 'ACTION' as const,
            entity_id: id,
            deep_link: `/actions/${id}`,
          })),
        });
      }

      await recordAudit(tx, ctx, {
        action: 'STATUS_CHANGE',
        entity: 'ACTION',
        entityId: id,
        entityReference: action.reference,
        changes: { status: { from: action.status, to: 'PENDING_VERIFICATION' } },
      });

      return updated;
    });
  },

  async verify(ctx: Ctx, id: string, input: VerifyActionInput) {
    return withTenant(ctx.orgId, async (tx) => {
      const action = await tx.actions.findUnique({ where: { id } });
      if (!action) throw notFound('Action');
      actionPolicy.assertCanVerify(ctx, action);

      const now = new Date();
      const updated = await tx.actions.update({
        where: { id },
        data: {
          status: 'VERIFIED_CLOSED',
          verified_at: now,
          closed_at: now,
          effectiveness: input.effectiveness,
          verification_comments: input.comments ?? null,
          verifier_user_id: action.verifier_user_id ?? ctx.userId,
        },
      });

      await tx.action_updates.create({
        data: {
          organization_id: ctx.orgId,
          action_id: id,
          user_id: ctx.userId,
          note: `Verified as ${input.effectiveness.toLowerCase().replace(/_/g, ' ')}.${
            input.comments ? ` ${input.comments}` : ''
          }`,
          status_from: action.status,
          status_to: 'VERIFIED_CLOSED',
        },
      });

      // An ineffective control is not a closed problem. Rather than leaving
      // it to someone to notice, the follow-up is created automatically and
      // linked to the original.
      let followUp: { id: string; reference: string } | null = null;
      if (input.effectiveness === 'NOT_EFFECTIVE') {
        const reference = await nextReference(tx, ctx.orgId);
        const dueDate = new Date();
        dueDate.setUTCDate(dueDate.getUTCDate() + 14);

        const created = await tx.actions.create({
          data: {
            organization_id: ctx.orgId,
            reference,
            title: `Follow-up: ${action.title}`,
            description:
              `The original action ${action.reference} was verified as not effective.` +
              (input.comments ? `\n\nVerifier's comments: ${input.comments}` : ''),
            action_type: action.action_type,
            status: 'OPEN',
            priority: 'HIGH',
            hierarchy_level: action.hierarchy_level,
            incident_id: action.incident_id,
            investigation_id: action.investigation_id,
            finding_id: action.finding_id,
            root_cause_id: action.root_cause_id,
            parent_action_id: action.id,
            site_id: action.site_id,
            owner_user_id: action.owner_user_id,
            verifier_user_id: action.verifier_user_id,
            created_by_user_id: ctx.userId,
            original_due_date: new Date(dueDate.toISOString().slice(0, 10)),
            due_date: new Date(dueDate.toISOString().slice(0, 10)),
            evidence_required: action.evidence_required,
          },
        });
        followUp = { id: created.id, reference: created.reference };

        await tx.notifications.create({
          data: {
            organization_id: ctx.orgId,
            recipient_user_id: action.owner_user_id,
            category: 'ACTION_ASSIGNED',
            title: `Follow-up action assigned: ${created.reference}`,
            body: `${action.reference} was not effective. A follow-up has been raised.`,
            entity: 'ACTION',
            entity_id: created.id,
            deep_link: `/actions/${created.id}`,
          },
        });
      }

      await recordAudit(tx, ctx, {
        action: 'APPROVE',
        entity: 'ACTION',
        entityId: id,
        entityReference: action.reference,
        changes: {
          status: { from: action.status, to: 'VERIFIED_CLOSED' },
          effectiveness: { from: null, to: input.effectiveness },
        },
      });

      // Advance the parent event when this was the last open action.
      let incidentReadyToClose = false;
      if (action.incident_id) {
        const open = await tx.actions.count({
          where: {
            incident_id: action.incident_id,
            status: { notIn: ['VERIFIED_CLOSED', 'CANCELLED'] },
          },
        });
        if (open === 0) {
          await tx.incidents.update({
            where: { id: action.incident_id },
            data: { status: 'PENDING_CLOSURE' },
          });
          incidentReadyToClose = true;
        }
      }

      return { ...updated, followUp, incidentReadyToClose };
    });
  },

  async reject(ctx: Ctx, id: string, comments: string) {
    return withTenant(ctx.orgId, async (tx) => {
      const action = await tx.actions.findUnique({ where: { id } });
      if (!action) throw notFound('Action');
      actionPolicy.assertCanVerify(ctx, action);

      const updated = await tx.actions.update({
        where: { id },
        data: { status: 'REJECTED', submitted_at: null },
      });
      await tx.action_updates.create({
        data: {
          organization_id: ctx.orgId,
          action_id: id,
          user_id: ctx.userId,
          note: `Returned to the owner: ${comments}`,
          status_from: action.status,
          status_to: 'REJECTED',
        },
      });
      await tx.notifications.create({
        data: {
          organization_id: ctx.orgId,
          recipient_user_id: action.owner_user_id,
          category: 'ACTION_VERIFICATION',
          title: `Action returned: ${action.reference}`,
          body: comments,
          entity: 'ACTION',
          entity_id: id,
          deep_link: `/actions/${id}`,
        },
      });
      return updated;
    });
  },

  async requestExtension(ctx: Ctx, id: string, input: RequestExtensionInput) {
    return withTenant(ctx.orgId, async (tx) => {
      const action = await tx.actions.findUnique({ where: { id } });
      if (!action) throw notFound('Action');
      actionPolicy.assertCanUpdateProgress(ctx, action);

      const pending = await tx.action_extensions.findFirst({
        where: { action_id: id, decided_at: null },
        select: { id: true },
      });
      if (pending) throw invalidState('An extension request is already awaiting a decision.');

      return tx.action_extensions.create({
        data: {
          organization_id: ctx.orgId,
          action_id: id,
          requested_by_user_id: ctx.userId,
          previous_due_date: action.due_date,
          requested_due_date: new Date(input.requestedDueDate.toISOString().slice(0, 10)),
          reason: input.reason,
        },
      });
    });
  },

  async decideExtension(ctx: Ctx, extensionId: string, approved: boolean, comments?: string) {
    return withTenant(ctx.orgId, async (tx) => {
      const extension = await tx.action_extensions.findUnique({ where: { id: extensionId } });
      if (!extension) throw notFound('Extension request');
      if (extension.decided_at) throw invalidState('This request has already been decided.');

      const action = await tx.actions.findUnique({ where: { id: extension.action_id } });
      if (!action) throw notFound('Action');
      actionPolicy.assertCanDecideExtension(ctx, action);

      await tx.action_extensions.update({
        where: { id: extensionId },
        data: {
          approved,
          decided_at: new Date(),
          decided_by_user_id: ctx.userId,
          decision_comments: comments ?? null,
        },
      });

      if (approved) {
        // original_due_date is never touched: every "on time" metric is
        // measured against the date first committed to, not the last one
        // negotiated.
        await tx.actions.update({
          where: { id: action.id },
          data: { due_date: extension.requested_due_date },
        });
        await recordAudit(tx, ctx, {
          action: 'UPDATE',
          entity: 'ACTION',
          entityId: action.id,
          entityReference: action.reference,
          changes: { due_date: { from: action.due_date, to: extension.requested_due_date } },
        });
      }

      await tx.notifications.create({
        data: {
          organization_id: ctx.orgId,
          recipient_user_id: action.owner_user_id,
          category: 'ACTION_DUE',
          title: `Extension ${approved ? 'approved' : 'declined'}: ${action.reference}`,
          body: comments ?? (approved ? 'Your new due date is set.' : 'The original due date stands.'),
          entity: 'ACTION',
          entity_id: action.id,
          deep_link: `/actions/${action.id}`,
        },
      });

      return { approved };
    });
  },

  async cancel(ctx: Ctx, id: string, reason: string) {
    return withTenant(ctx.orgId, async (tx) => {
      const action = await tx.actions.findUnique({ where: { id } });
      if (!action) throw notFound('Action');
      actionPolicy.assertCanCancel(ctx, action);

      const updated = await tx.actions.update({
        where: { id },
        data: { status: 'CANCELLED', cancelled_reason: reason, closed_at: new Date() },
      });
      await recordAudit(tx, ctx, {
        action: 'STATUS_CHANGE',
        entity: 'ACTION',
        entityId: id,
        entityReference: action.reference,
        changes: { status: { from: action.status, to: 'CANCELLED' } },
      });
      return updated;
    });
  },
};

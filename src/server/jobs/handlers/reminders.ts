import { unsafeGlobalQuery, withTenant } from '@/server/db/tenant';
import { logger } from '@/server/lib/logger';
import type { JobResult } from '../types';
import { claimKey, claimNotifications, type NotificationClaim } from './notification-claim';

const OPEN_ACTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'REJECTED'] as const;

function dateOnly(d: Date): Date {
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
}

/**
 * Enumerating tenants is the one thing a job must do before it can scope to
 * one — and RLS correctly forbids reading `organizations` with no tenant
 * context, so a plain findMany here returns zero rows and every job silently
 * does nothing. app.active_organization_ids() is a SECURITY DEFINER function
 * that returns ids and nothing else. See db/schema.sql.
 */
async function activeOrgIds(): Promise<string[]> {
  const rows = await unsafeGlobalQuery().$queryRaw<{ id: string }[]>`
    SELECT app.active_organization_ids()::text AS id
  `;
  return rows.map((r) => r.id);
}

/**
 * Action due reminders at T-7d, T-3d and T-1d.
 *
 * Safe to run repeatedly: notification_log holds the claim, and a re-run
 * claims nothing and sends nothing. That is what makes an HTTP-triggered
 * cron (which retries) acceptable here.
 */
export async function remindActionsDue(now: Date): Promise<JobResult> {
  const result: JobResult = { job: 'reminders.actions', processed: 0, skipped: 0, errors: 0 };

  for (const orgId of await activeOrgIds()) {
    try {
      await withTenant(orgId, async (tx) => {
        for (const days of [7, 3, 1]) {
          const target = new Date(now);
          target.setUTCDate(target.getUTCDate() + days);
          const dueDate = dateOnly(target);

          const due = await tx.actions.findMany({
            where: { status: { in: [...OPEN_ACTION_STATUSES] }, due_date: dueDate },
            select: { id: true, reference: true, title: true, owner_user_id: true },
          });
          if (due.length === 0) continue;

          const claims: NotificationClaim[] = due.map((a) => ({
            entityId: a.id,
            recipientUserId: a.owner_user_id,
          }));

          const claimed = await claimNotifications(tx, {
            organizationId: orgId,
            entity: 'ACTION',
            ruleKey: `ACTION_DUE:-${days}d`,
            scheduledFor: dueDate,
            claims,
          });

          const toSend = due.filter((a) => claimed.has(claimKey(a.id, a.owner_user_id)));
          result.skipped += due.length - toSend.length;

          if (toSend.length > 0) {
            await tx.notifications.createMany({
              data: toSend.map((a) => ({
                organization_id: orgId,
                recipient_user_id: a.owner_user_id,
                category: 'ACTION_DUE' as const,
                title: `Action due in ${days} day${days === 1 ? '' : 's'}: ${a.reference}`,
                body: a.title,
                entity: 'ACTION' as const,
                entity_id: a.id,
                deep_link: `/actions/${a.id}`,
              })),
            });
            result.processed += toSend.length;
          }
        }
      });
    } catch (err) {
      logger.error({ err, orgId }, 'reminders.actions failed for organization');
      result.errors += 1;
    }
  }

  return result;
}

/** Tiered escalation: owner at +1d, site/HSE at +7d, executives at +21d. */
const TIERS = [
  { days: 1, category: 'ACTION_OVERDUE' as const, roles: [] as string[] },
  { days: 7, category: 'ACTION_ESCALATED' as const, roles: ['SITE_MANAGER', 'HSE_MANAGER'] },
  { days: 21, category: 'ACTION_ESCALATED' as const, roles: ['EXECUTIVE'] },
];

export async function escalateOverdueActions(now: Date): Promise<JobResult> {
  const result: JobResult = { job: 'escalations.actions', processed: 0, skipped: 0, errors: 0 };
  const today = dateOnly(now);

  for (const orgId of await activeOrgIds()) {
    try {
      await withTenant(orgId, async (tx) => {
        for (const tier of TIERS) {
          const cutoff = new Date(now);
          cutoff.setUTCDate(cutoff.getUTCDate() - tier.days);

          const overdue = await tx.actions.findMany({
            where: {
              status: { in: [...OPEN_ACTION_STATUSES] },
              due_date: { lte: dateOnly(cutoff) },
            },
            select: { id: true, reference: true, title: true, owner_user_id: true },
          });
          if (overdue.length === 0) continue;

          // Resolve recipients once per tier, not once per action.
          let recipientIds: string[];
          if (tier.roles.length === 0) {
            recipientIds = [];
          } else {
            const managers = await tx.memberships.findMany({
              where: {
                role: { in: tier.roles as never[] },
                is_active: true,
              },
              select: { user_id: true },
            });
            recipientIds = [...new Set(managers.map((m) => m.user_id))];
          }

          const claims: NotificationClaim[] = [];
          for (const action of overdue) {
            const targets = tier.roles.length === 0 ? [action.owner_user_id] : recipientIds;
            for (const userId of targets) {
              claims.push({ entityId: action.id, recipientUserId: userId });
            }
          }
          if (claims.length === 0) continue;

          const claimed = await claimNotifications(tx, {
            organizationId: orgId,
            entity: 'ACTION',
            ruleKey: `ACTION_ESCALATION:+${tier.days}d`,
            scheduledFor: today,
            claims,
          });
          result.skipped += claims.length - claimed.size;
          if (claimed.size === 0) continue;

          const byId = new Map(overdue.map((a) => [a.id, a]));
          const rows = claims
            .filter((c) => claimed.has(claimKey(c.entityId, c.recipientUserId)))
            .map((c) => {
              const action = byId.get(c.entityId)!;
              return {
                organization_id: orgId,
                recipient_user_id: c.recipientUserId,
                category: tier.category,
                title: `Overdue ${tier.days}+ day${tier.days === 1 ? '' : 's'}: ${action.reference}`,
                body: action.title,
                entity: 'ACTION' as const,
                entity_id: action.id,
                deep_link: `/actions/${action.id}`,
              };
            });

          await tx.notifications.createMany({ data: rows });
          result.processed += rows.length;
        }
      });
    } catch (err) {
      logger.error({ err, orgId }, 'escalations.actions failed for organization');
      result.errors += 1;
    }
  }

  return result;
}

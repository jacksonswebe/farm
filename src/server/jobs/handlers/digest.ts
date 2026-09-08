import { unsafeGlobalQuery, withTenant } from '@/server/db/tenant';
import { logger } from '@/server/lib/logger';
import { createMailer } from '@/server/services/mail';
import { templates } from '@/server/services/mail/templates';
import type { JobResult } from '../types';

const DIGEST_ROLES = ['HSE_MANAGER', 'SITE_MANAGER', 'EXECUTIVE'] as const;

async function activeOrgIds(): Promise<string[]> {
  const rows = await unsafeGlobalQuery().$queryRaw<{ id: string }[]>`
    SELECT app.active_organization_ids()::text AS id`;
  return rows.map((r) => r.id);
}

/**
 * The Monday summary. One email per recipient per week, and it is the only
 * message in the system a recipient may switch off entirely — assignment and
 * escalation are not optional.
 */
export async function sendWeeklyDigest(now: Date): Promise<JobResult> {
  const result: JobResult = { job: 'digest.weekly', processed: 0, skipped: 0, errors: 0 };
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const scheduledFor = new Date(now.toISOString().slice(0, 10));

  for (const orgId of await activeOrgIds()) {
    try {
      await withTenant(orgId, async (tx) => {
        const org = await tx.organizations.findFirst({ select: { name: true } });
        if (!org) return;

        const [reported, open, overdue, awaiting, closed] = await Promise.all([
          tx.incidents.count({
            where: {
              reported_at: { gte: weekAgo },
              status: { notIn: ['DRAFT', 'REJECTED', 'DUPLICATE'] },
            },
          }),
          tx.incidents.count({
            where: {
              status: { in: ['SUBMITTED', 'ACKNOWLEDGED', 'INVESTIGATING', 'ACTIONS_PENDING', 'PENDING_CLOSURE'] },
            },
          }),
          tx.actions.count({
            where: { status: { in: ['OPEN', 'IN_PROGRESS', 'REJECTED'] }, due_date: { lt: now } },
          }),
          tx.actions.count({ where: { status: 'PENDING_VERIFICATION' } }),
          tx.incidents.count({ where: { closed_at: { gte: weekAgo } } }),
        ]);

        const recipients = await tx.memberships.findMany({
          where: { role: { in: [...DIGEST_ROLES] }, is_active: true },
          select: { user_id: true, users: { select: { email: true, deleted_at: true } } },
        });

        const message = templates.weeklyDigest({
          orgName: org.name,
          reported, open, overdue,
          awaitingVerification: awaiting,
          closedThisWeek: closed,
        });

        for (const r of recipients) {
          if (!r.users || r.users.deleted_at) { result.skipped += 1; continue; }

          // One digest per recipient per week, enforced by the log's unique key
          // rather than by hoping the schedule fires exactly once.
          try {
            await tx.notification_log.create({
              data: {
                organization_id: orgId,
                entity: 'ORGANIZATION',
                entity_id: orgId,
                rule_key: 'WEEKLY_DIGEST',
                recipient_user_id: r.user_id,
                scheduled_for: scheduledFor,
              },
            });
          } catch {
            result.skipped += 1;
            continue;
          }

          const notification = await tx.notifications.create({
            data: {
              organization_id: orgId,
              recipient_user_id: r.user_id,
              category: 'WEEKLY_DIGEST',
              title: message.subject,
              body: message.text,
              deep_link: '/dashboard',
            },
          });

          const delivery = await tx.notification_deliveries.create({
            data: {
              organization_id: orgId,
              notification_id: notification.id,
              channel: 'EMAIL',
              status: 'QUEUED',
              provider: createMailer().name,
            },
          });

          try {
            const sent = await createMailer().send({ to: r.users.email, ...message });
            await tx.notification_deliveries.update({
              where: { id: delivery.id },
              data: { status: 'SENT', sent_at: new Date(), attempts: 1, provider_message_id: sent.id },
            });
            result.processed += 1;
          } catch (err) {
            await tx.notification_deliveries.update({
              where: { id: delivery.id },
              data: {
                status: 'FAILED',
                attempts: 1,
                error: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
              },
            });
            result.errors += 1;
          }
        }
      });
    } catch (err) {
      logger.error({ err, orgId }, 'digest.weekly failed for organization');
      result.errors += 1;
    }
  }

  return result;
}

import type { notification_category } from '@prisma/client';
import type { TenantTx } from '@/server/db/tenant';
import { logger } from '@/server/lib/logger';
import { createMailer, type MailMessage } from '@/server/services/mail';

/**
 * Creates an in-app notification and, when an email body is supplied, attempts
 * delivery and records the outcome.
 *
 * Delivery is recorded whether it succeeds or fails, because "we told them" is
 * a claim an EHS customer has to be able to evidence during an audit. A failed
 * send never aborts the caller's transaction: an email provider being down must
 * not prevent an action from being assigned.
 */
export interface DispatchInput {
  organizationId: string;
  recipientUserId: string;
  category: notification_category;
  title: string;
  body: string;
  entity?: 'INCIDENT' | 'INVESTIGATION' | 'ACTION';
  entityId?: string;
  deepLink?: string;
  email?: Omit<MailMessage, 'to'>;
}

export async function dispatch(tx: TenantTx, input: DispatchInput): Promise<void> {
  const notification = await tx.notifications.create({
    data: {
      organization_id: input.organizationId,
      recipient_user_id: input.recipientUserId,
      category: input.category,
      title: input.title,
      body: input.body,
      entity: input.entity ?? null,
      entity_id: input.entityId ?? null,
      deep_link: input.deepLink ?? null,
    },
  });

  if (!input.email) return;

  const user = await tx.users.findUnique({
    where: { id: input.recipientUserId },
    select: { email: true, deleted_at: true },
  });
  if (!user || user.deleted_at) return;

  const delivery = await tx.notification_deliveries.create({
    data: {
      organization_id: input.organizationId,
      notification_id: notification.id,
      channel: 'EMAIL',
      status: 'QUEUED',
      provider: createMailer().name,
    },
  });

  try {
    const result = await createMailer().send({ to: user.email, ...input.email });
    await tx.notification_deliveries.update({
      where: { id: delivery.id },
      data: {
        status: 'SENT',
        sent_at: new Date(),
        attempts: 1,
        provider_message_id: result.id,
      },
    });
  } catch (err) {
    // Recorded, surfaced to the org admin, and deliberately not rethrown.
    await tx.notification_deliveries.update({
      where: { id: delivery.id },
      data: {
        status: 'FAILED',
        attempts: 1,
        error: err instanceof Error ? err.message.slice(0, 500) : 'unknown error',
      },
    });
    logger.error({ err, notificationId: notification.id }, 'email delivery failed');
  }
}

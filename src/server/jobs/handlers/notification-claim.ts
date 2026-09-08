import { Prisma } from '@prisma/client';
import type { TenantTx } from '@/server/db/tenant';

/**
 * Claims the right to send a set of notifications, atomically.
 *
 * Why this exists: the obvious idempotency pattern — try the insert, catch
 * the unique violation, skip — is broken inside a transaction. PostgreSQL
 * aborts the whole transaction on a constraint violation (SQLSTATE 25P02),
 * so catching the error in JavaScript leaves the transaction unusable and
 * every subsequent statement fails. In a reminder job that means the first
 * duplicate silently kills the rest of the run.
 *
 * INSERT ... ON CONFLICT DO NOTHING RETURNING is the correct primitive: it
 * never raises, never aborts, and returns exactly the rows it inserted —
 * which is precisely the set we are allowed to send.
 */
export interface NotificationClaim {
  entityId: string;
  recipientUserId: string;
}

export async function claimNotifications(
  tx: TenantTx,
  params: {
    organizationId: string;
    entity: 'ACTION' | 'INCIDENT' | 'INVESTIGATION';
    ruleKey: string;
    scheduledFor: Date;
    claims: NotificationClaim[];
  },
): Promise<Set<string>> {
  if (params.claims.length === 0) return new Set();

  const values = params.claims.map(
    (c) => Prisma.sql`(
      ${params.organizationId}::uuid,
      ${params.entity}::entity_type,
      ${c.entityId}::uuid,
      ${params.ruleKey},
      ${c.recipientUserId}::uuid,
      ${params.scheduledFor}::date
    )`,
  );

  const inserted = await tx.$queryRaw<{ entity_id: string; recipient_user_id: string }[]>`
    INSERT INTO notification_log
      (organization_id, entity, entity_id, rule_key, recipient_user_id, scheduled_for)
    VALUES ${Prisma.join(values)}
    ON CONFLICT DO NOTHING
    RETURNING entity_id::text, recipient_user_id::text
  `;

  return new Set(inserted.map((r) => `${r.entity_id}:${r.recipient_user_id}`));
}

export const claimKey = (entityId: string, userId: string) => `${entityId}:${userId}`;

import type { audit_action, entity_type, Prisma } from '@prisma/client';
import type { Ctx } from '@/server/auth/context';
import type { TenantTx } from '@/server/db/tenant';

export interface AuditInput {
  action: audit_action;
  entity: entity_type;
  entityId?: string;
  entityReference?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  metadata?: Record<string, unknown>;
}

/**
 * Writes an audit row inside the caller's transaction, so the audit entry
 * and the change it describes commit or roll back together. An audited
 * change that succeeded while its audit row failed is worse than no audit
 * trail, because it looks complete.
 *
 * audit_events is append-only: the application role has INSERT and SELECT
 * only (db/schema.sql section 14).
 */
export async function recordAudit(tx: TenantTx, ctx: Ctx, input: AuditInput): Promise<void> {
  await tx.audit_events.create({
    data: {
      organization_id: ctx.orgId,
      actor_user_id: ctx.userId,
      action: input.action,
      entity: input.entity,
      entity_id: input.entityId ?? null,
      entity_reference: input.entityReference ?? null,
      changes: (input.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      request_id: ctx.requestId,
    },
  });
}

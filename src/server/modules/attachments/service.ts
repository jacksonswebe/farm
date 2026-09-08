import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { entity_type } from '@prisma/client';
import type { Ctx } from '@/server/auth/context';
import { requirePermission } from '@/server/auth/context';
import { withTenant, type TenantTx } from '@/server/db/tenant';
import { AppError, ErrorCode, notFound, denied } from '@/server/lib/errors';
import { createStorage } from '@/server/services/storage';
import { recordAudit } from '@/server/modules/audit/service';
import { MAX_BYTES, MAX_VIDEO_BYTES, type PresignInput } from './schema';

const PUT_EXPIRY = Number(process.env.S3_PRESIGN_PUT_EXPIRY_SECONDS ?? 300);
const GET_EXPIRY = Number(process.env.S3_PRESIGN_GET_EXPIRY_SECONDS ?? 900);

/**
 * Confirms the caller may attach to this record, and that the record exists
 * in this tenant. Without this check any authenticated user could hang files
 * off another tenant's incident id.
 */
async function assertCanAttach(tx: TenantTx, ctx: Ctx, entity: entity_type, entityId: string) {
  switch (entity) {
    case 'INCIDENT': {
      const row = await tx.incidents.findUnique({
        where: { id: entityId },
        select: { id: true, status: true, reported_by_user_id: true, site_id: true },
      });
      if (!row) throw notFound('Event');
      if (row.status === 'CLOSED') throw denied('This event is closed.');
      return;
    }
    case 'INVESTIGATION': {
      const row = await tx.investigations.findUnique({
        where: { id: entityId },
        select: { id: true, status: true, lead_investigator_id: true, team_user_ids: true },
      });
      if (!row) throw notFound('Investigation');
      if (row.status === 'APPROVED') throw denied('This investigation is closed to edits.');
      const onTeam =
        row.lead_investigator_id === ctx.userId || row.team_user_ids.includes(ctx.userId);
      if (ctx.role === 'INVESTIGATOR' && !onTeam) throw denied('You are not on this investigation.');
      return;
    }
    case 'ACTION': {
      const row = await tx.actions.findUnique({
        where: { id: entityId },
        select: { id: true, status: true, owner_user_id: true },
      });
      if (!row) throw notFound('Action');
      if (['VERIFIED_CLOSED', 'CANCELLED'].includes(row.status)) {
        throw denied('This action is closed.');
      }
      const isOwner = row.owner_user_id === ctx.userId;
      const isManager = ctx.role === 'HSE_MANAGER' || ctx.role === 'SITE_MANAGER';
      if (!isOwner && !isManager) throw denied('Only the owner may attach evidence to this action.');
      return;
    }
    case 'FINDING': {
      const row = await tx.findings.findUnique({
        where: { id: entityId },
        select: { id: true },
      });
      if (!row) throw notFound('Finding');
      return;
    }
    default:
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Attachments are not supported on that record.');
  }
}

export const attachmentService = {
  /**
   * Step 1 of the upload: validate, reserve a row, and hand back a short-lived
   * presigned PUT. The file itself never touches the application server.
   */
  async presign(ctx: Ctx, input: PresignInput) {
    requirePermission(ctx, 'attachment.upload');

    const isVideo = input.mimeType.startsWith('video/');
    const cap = isVideo ? MAX_VIDEO_BYTES : MAX_BYTES;
    if (input.sizeBytes > cap) {
      throw new AppError(
        ErrorCode.FILE_TOO_LARGE,
        `That file is ${(input.sizeBytes / 1024 / 1024).toFixed(1)} MB. The limit is ${Math.round(cap / 1024 / 1024)} MB.`,
      );
    }

    return withTenant(ctx.orgId, async (tx) => {
      await assertCanAttach(tx, ctx, input.entity, input.entityId);

      // Storage quota is a plan limit; check it before issuing the URL rather
      // than discovering it after the bytes are already uploaded.
      const sub = await tx.subscriptions.findFirst({ select: { storage_limit_gb: true } });
      if (sub) {
        const used = await tx.attachments.aggregate({
          where: { upload_status: 'UPLOADED', deleted_at: null },
          _sum: { size_bytes: true },
        });
        const usedBytes = Number(used._sum.size_bytes ?? 0);
        if (usedBytes + input.sizeBytes > sub.storage_limit_gb * 1024 ** 3) {
          throw new AppError(
            ErrorCode.PLAN_LIMIT_EXCEEDED,
            'Your plan storage limit has been reached. Upgrade or remove older files.',
          );
        }
      }

      const ext = extname(input.fileName).slice(0, 10) || '';
      const key = `org/${ctx.orgId}/${input.entity.toLowerCase()}/${input.entityId}/${randomUUID()}${ext}`;

      const attachment = await tx.attachments.create({
        data: {
          organization_id: ctx.orgId,
          entity: input.entity,
          entity_id: input.entityId,
          storage_key: key,
          file_name: input.fileName,
          mime_type: input.mimeType,
          size_bytes: input.sizeBytes,
          caption: input.caption ?? null,
          is_sensitive: input.isSensitive,
          upload_status: 'PENDING',
          uploaded_by_user_id: ctx.userId,
        },
      });

      const uploadUrl = await createStorage().presignPut(key, input.mimeType, PUT_EXPIRY);
      return {
        attachmentId: attachment.id,
        uploadUrl,
        expiresAt: new Date(Date.now() + PUT_EXPIRY * 1000),
      };
    });
  },

  /**
   * Step 2: the client says it finished. The server verifies against storage
   * rather than believing it — a PENDING row whose object does not exist, or
   * whose size does not match what was declared, is never marked UPLOADED.
   */
  async complete(ctx: Ctx, attachmentId: string) {
    return withTenant(ctx.orgId, async (tx) => {
      const attachment = await tx.attachments.findUnique({ where: { id: attachmentId } });
      if (!attachment) throw notFound('Attachment');
      if (attachment.uploaded_by_user_id !== ctx.userId && ctx.role !== 'HSE_MANAGER') {
        throw denied('That upload belongs to someone else.');
      }
      if (attachment.upload_status === 'UPLOADED') return attachment;

      const object = await createStorage().head(attachment.storage_key);
      if (!object) {
        throw new AppError(
          ErrorCode.BUSINESS_RULE_VIOLATION,
          'The file was not found in storage. The upload did not complete.',
        );
      }
      // size_bytes is a bigint in the database; compare as numbers.
      if (object.sizeBytes !== Number(attachment.size_bytes)) {
        // Declared size and stored size must agree, or the quota check that
        // gated the presign was meaningless.
        await tx.attachments.update({
          where: { id: attachmentId },
          data: { upload_status: 'FAILED' },
        });
        throw new AppError(
          ErrorCode.BUSINESS_RULE_VIOLATION,
          'The uploaded file does not match what was declared. It has been rejected.',
        );
      }

      const updated = await tx.attachments.update({
        where: { id: attachmentId },
        data: { upload_status: 'UPLOADED' },
      });

      await recordAudit(tx, ctx, {
        action: 'CREATE',
        entity: 'ATTACHMENT',
        entityId: attachmentId,
        metadata: { fileName: attachment.file_name, entity: attachment.entity },
      });

      return updated;
    });
  },

  /** Presigned read. No object is ever public. */
  async getUrl(ctx: Ctx, attachmentId: string) {
    return withTenant(ctx.orgId, async (tx) => {
      const attachment = await tx.attachments.findUnique({ where: { id: attachmentId } });
      if (!attachment || attachment.deleted_at) throw notFound('Attachment');
      if (attachment.upload_status !== 'UPLOADED') throw notFound('Attachment');

      if (attachment.is_sensitive) {
        const permitted = ctx.role === 'HSE_MANAGER' || ctx.role === 'INVESTIGATOR';
        if (!permitted) throw notFound('Attachment');
        await recordAudit(tx, ctx, {
          action: 'VIEW_SENSITIVE',
          entity: 'ATTACHMENT',
          entityId: attachmentId,
        });
      }

      const url = await createStorage().presignGet(attachment.storage_key, GET_EXPIRY);
      return {
        url,
        fileName: attachment.file_name,
        mimeType: attachment.mime_type,
        expiresAt: new Date(Date.now() + GET_EXPIRY * 1000),
      };
    });
  },

  async list(ctx: Ctx, entity: entity_type, entityId: string) {
    return withTenant(ctx.orgId, (tx) =>
      tx.attachments.findMany({
        where: { entity, entity_id: entityId, deleted_at: null, upload_status: 'UPLOADED' },
        select: {
          id: true, file_name: true, mime_type: true, size_bytes: true,
          caption: true, is_sensitive: true, created_at: true,
        },
        orderBy: { created_at: 'asc' },
      }),
    );
  },

  async remove(ctx: Ctx, attachmentId: string) {
    requirePermission(ctx, 'attachment.delete');
    return withTenant(ctx.orgId, async (tx) => {
      const attachment = await tx.attachments.findUnique({ where: { id: attachmentId } });
      if (!attachment) throw notFound('Attachment');
      const isUploader = attachment.uploaded_by_user_id === ctx.userId;
      if (!isUploader && ctx.role !== 'HSE_MANAGER') {
        throw denied('You may only remove files you uploaded.');
      }
      // Soft delete: the object is purged by the nightly cleanup job, so a
      // mistaken deletion during an investigation is recoverable.
      await tx.attachments.update({
        where: { id: attachmentId },
        data: { deleted_at: new Date() },
      });
      await recordAudit(tx, ctx, {
        action: 'DELETE',
        entity: 'ATTACHMENT',
        entityId: attachmentId,
        metadata: { fileName: attachment.file_name },
      });
      return { deleted: true };
    });
  },
};

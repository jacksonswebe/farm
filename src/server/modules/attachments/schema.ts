import { z } from 'zod';

/**
 * Upload allowlist. Evidence in an EHS system is overwhelmingly phone photos,
 * with PDFs for certificates and short video for a mechanism. Everything else
 * is refused: an attachment pipeline that accepts arbitrary types is a malware
 * distribution channel with an audit trail.
 */
export const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf',
  'video/mp4', 'video/quicktime',
]);

export const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024);
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export const presignSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().refine((m) => ALLOWED_MIME.has(m), {
    message: 'That file type is not accepted. Use a photo, a PDF, or an MP4.',
  }),
  sizeBytes: z.number().int().positive(),
  entity: z.enum(['INCIDENT', 'INVESTIGATION', 'ACTION', 'FINDING']),
  entityId: z.string().uuid(),
  caption: z.string().trim().max(500).optional(),
  isSensitive: z.boolean().default(false),
});

export type PresignInput = z.infer<typeof presignSchema>;

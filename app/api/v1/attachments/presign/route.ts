import { handler } from '@/server/lib/route';
import { presignSchema } from '@/server/modules/attachments/schema';
import { attachmentService } from '@/server/modules/attachments/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(
  presignSchema,
  (ctx, input) => attachmentService.presign(ctx, input),
  { status: 201 },
);

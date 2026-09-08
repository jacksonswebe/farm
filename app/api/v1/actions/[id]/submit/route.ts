import { handler } from '@/server/lib/route';
import { submitActionSchema } from '@/server/modules/actions/schema';
import { actionService } from '@/server/modules/actions/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(submitActionSchema, (ctx, input, params) =>
  actionService.submitForVerification(ctx, params.id!, input.evidenceAttachmentIds, input.note),
);

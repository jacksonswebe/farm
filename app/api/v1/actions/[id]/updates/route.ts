import { handler } from '@/server/lib/route';
import { progressUpdateSchema } from '@/server/modules/actions/schema';
import { actionService } from '@/server/modules/actions/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(
  progressUpdateSchema,
  (ctx, input, params) => actionService.addProgress(ctx, params.id!, input.note, input.progressPercent),
  { status: 201 },
);

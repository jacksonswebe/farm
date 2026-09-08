import { handler } from '@/server/lib/route';
import { cancelActionSchema } from '@/server/modules/actions/schema';
import { actionService } from '@/server/modules/actions/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(cancelActionSchema, (ctx, input, params) =>
  actionService.cancel(ctx, params.id!, input.reason),
);

import { handler } from '@/server/lib/route';
import { verifyActionSchema } from '@/server/modules/actions/schema';
import { actionService } from '@/server/modules/actions/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(verifyActionSchema, (ctx, input, params) =>
  actionService.verify(ctx, params.id!, input),
);

import { handler } from '@/server/lib/route';
import { rejectActionSchema } from '@/server/modules/actions/schema';
import { actionService } from '@/server/modules/actions/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(rejectActionSchema, (ctx, input, params) =>
  actionService.reject(ctx, params.id!, input.comments),
);

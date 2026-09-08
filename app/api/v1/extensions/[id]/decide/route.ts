import { handler } from '@/server/lib/route';
import { decideExtensionSchema } from '@/server/modules/actions/schema';
import { actionService } from '@/server/modules/actions/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(decideExtensionSchema, (ctx, input, params) =>
  actionService.decideExtension(ctx, params.id!, input.approved, input.comments),
);

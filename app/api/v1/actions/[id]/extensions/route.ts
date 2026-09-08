import { handler } from '@/server/lib/route';
import { requestExtensionSchema } from '@/server/modules/actions/schema';
import { actionService } from '@/server/modules/actions/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(
  requestExtensionSchema,
  (ctx, input, params) => actionService.requestExtension(ctx, params.id!, input),
  { status: 201 },
);

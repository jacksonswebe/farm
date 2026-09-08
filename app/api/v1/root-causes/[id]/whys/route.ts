import { handler } from '@/server/lib/route';
import { whysSchema } from '@/server/modules/investigations/schema';
import { investigationService } from '@/server/modules/investigations/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const PUT = handler(whysSchema, (ctx, input, params) =>
  investigationService.replaceWhys(ctx, params.id!, input),
);

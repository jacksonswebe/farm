import { handler } from '@/server/lib/route';
import { rootCauseSchema } from '@/server/modules/investigations/schema';
import { investigationService } from '@/server/modules/investigations/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(
  rootCauseSchema,
  (ctx, input, params) => investigationService.addRootCause(ctx, params.id!, input),
  { status: 201 },
);

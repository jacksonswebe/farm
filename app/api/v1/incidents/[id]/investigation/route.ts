import { handler } from '@/server/lib/route';
import { assignInvestigationSchema } from '@/server/modules/investigations/schema';
import { investigationService } from '@/server/modules/investigations/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(
  assignInvestigationSchema,
  (ctx, input, params) => investigationService.assign(ctx, params.id!, input),
  { status: 201 },
);

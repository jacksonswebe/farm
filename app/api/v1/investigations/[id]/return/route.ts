import { handler } from '@/server/lib/route';
import { returnInvestigationSchema } from '@/server/modules/investigations/schema';
import { investigationService } from '@/server/modules/investigations/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(returnInvestigationSchema, (ctx, input, params) =>
  investigationService.returnForRework(ctx, params.id!, input.comments),
);

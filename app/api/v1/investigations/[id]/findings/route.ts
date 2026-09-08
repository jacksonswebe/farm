import { handler } from '@/server/lib/route';
import { findingSchema } from '@/server/modules/investigations/schema';
import { investigationService } from '@/server/modules/investigations/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(
  findingSchema,
  (ctx, input, params) => investigationService.addFinding(ctx, params.id!, input),
  { status: 201 },
);

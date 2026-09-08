import { handler } from '@/server/lib/route';
import { timelineEntrySchema } from '@/server/modules/investigations/schema';
import { investigationService } from '@/server/modules/investigations/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(
  timelineEntrySchema,
  (ctx, input, params) => investigationService.addTimelineEntry(ctx, params.id!, input),
  { status: 201 },
);

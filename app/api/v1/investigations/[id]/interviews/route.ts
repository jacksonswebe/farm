import { handler } from '@/server/lib/route';
import { interviewSchema } from '@/server/modules/investigations/schema';
import { investigationService } from '@/server/modules/investigations/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(
  interviewSchema,
  (ctx, input, params) => investigationService.addInterview(ctx, params.id!, input),
  { status: 201 },
);

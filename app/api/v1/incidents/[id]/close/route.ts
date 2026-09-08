import { handler } from '@/server/lib/route';
import { closeIncidentSchema } from '@/server/modules/incidents/schema';
import { incidentService } from '@/server/modules/incidents/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(closeIncidentSchema, (ctx, input, params) =>
  incidentService.close(ctx, params.id!, input.closureStatement, input.lessonsLearned),
);

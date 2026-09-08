import { type NextRequest } from 'next/server';
import { requireCtx } from '@/server/auth/current';
import { created, paginated, parseQuery, requestId, toErrorResponse } from '@/server/lib/api';
import { incidentService } from '@/server/modules/incidents/service';
import { createIncidentSchema, listIncidentsSchema } from '@/server/modules/incidents/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const reqId = requestId();
  try {
    const ctx = await requireCtx(reqId);
    const input = parseQuery(req.url, listIncidentsSchema);
    const { data, meta } = await incidentService.list(ctx, input);
    return paginated(data, meta);
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

export async function POST(req: NextRequest) {
  const reqId = requestId();
  try {
    const ctx = await requireCtx(reqId);
    const input = createIncidentSchema.parse(await req.json());
    const incident = await incidentService.create(ctx, input);
    return created({
      id: incident.id,
      reference: incident.reference,
      status: incident.status,
    });
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

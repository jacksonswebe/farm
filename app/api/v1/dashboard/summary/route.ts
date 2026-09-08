import { requireCtx } from '@/server/auth/current';
import { ok, requestId, toErrorResponse } from '@/server/lib/api';
import { incidentService } from '@/server/modules/incidents/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const reqId = requestId();
  try {
    const ctx = await requireCtx(reqId);
    return ok(await incidentService.dashboardSummary(ctx));
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

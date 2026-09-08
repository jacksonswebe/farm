import { type NextRequest } from 'next/server';
import { requireCtx } from '@/server/auth/current';
import { ok, requestId, toErrorResponse } from '@/server/lib/api';
import { classifyIncidentSchema } from '@/server/modules/incidents/schema';
import { incidentService } from '@/server/modules/incidents/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const reqId = requestId();
  try {
    const ctx = await requireCtx(reqId);
    const { id } = await params;
    const input = classifyIncidentSchema.parse(await req.json());
    const updated = await incidentService.classify(ctx, id, input);
    return ok({
      id: updated.id,
      severity: updated.severity,
      likelihood: updated.likelihood,
      riskScore: updated.risk_score,
      riskBand: updated.risk_band,
      status: updated.status,
      investigationRequired: updated.investigation_required,
    });
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

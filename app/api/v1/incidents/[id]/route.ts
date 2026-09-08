import { type NextRequest } from 'next/server';
import { requireCtx } from '@/server/auth/current';
import { ok, requestId, toErrorResponse } from '@/server/lib/api';
import { incidentService } from '@/server/modules/incidents/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const reqId = requestId();
  try {
    const ctx = await requireCtx(reqId);
    const { id } = await params;
    return ok(await incidentService.getById(ctx, id));
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

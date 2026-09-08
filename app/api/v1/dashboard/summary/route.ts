import { type NextRequest } from 'next/server';
import { requireCtx } from '@/server/auth/current';
import { ok, requestId, toErrorResponse } from '@/server/lib/api';
import { analyticsService } from '@/server/modules/analytics/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const reqId = requestId();
  try {
    const ctx = await requireCtx(reqId);
    const days = Number(new URL(req.url).searchParams.get('days') ?? 30);
    // One call for the whole dashboard, not twelve. It is the most-loaded
    // page in the product.
    return ok(await analyticsService.summary(ctx, Number.isFinite(days) ? days : 30));
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

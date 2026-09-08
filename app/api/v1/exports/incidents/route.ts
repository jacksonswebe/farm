import { type NextRequest } from 'next/server';
import { requireCtx } from '@/server/auth/current';
import { requestId, toErrorResponse } from '@/server/lib/api';
import { exportService } from '@/server/modules/exports/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const reqId = requestId();
  try {
    const ctx = await requireCtx(reqId);
    const includeSensitive = new URL(req.url).searchParams.get('sensitive') === 'true';
    const csv = await exportService.incidentsCsv(ctx, includeSensitive);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="safesphere-events-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

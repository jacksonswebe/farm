import { type NextRequest } from 'next/server';
import { requireCtx } from '@/server/auth/current';
import { requestId, toErrorResponse } from '@/server/lib/api';
import { exportService } from '@/server/modules/exports/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const reqId = requestId();
  try {
    const ctx = await requireCtx(reqId);
    const { id } = await params;
    const { pdf, reference } = await exportService.incidentEvidencePack(ctx, id);
    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${reference}-evidence-pack.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

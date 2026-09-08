import { type NextRequest } from 'next/server';
import { created, requestId, toErrorResponse } from '@/server/lib/api';
import { clientIp } from '@/server/lib/ratelimit';
import { anonymousReportSchema } from '@/server/modules/incidents/schema';
import { anonymousReportService } from '@/server/modules/incidents/anonymous';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Public by design — the site token is the only credential. Rate limited in the service. */
export async function POST(req: NextRequest) {
  const reqId = requestId();
  try {
    const input = anonymousReportSchema.parse(await req.json());
    return created(await anonymousReportService.submit(input, clientIp(req)));
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

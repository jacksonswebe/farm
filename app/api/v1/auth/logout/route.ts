import { destroySession } from '@/server/auth/session';
import { ok, requestId, toErrorResponse } from '@/server/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const reqId = requestId();
  try {
    await destroySession();
    return ok({ signedOut: true });
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

import { type NextRequest } from 'next/server';
import { requireCtx } from '@/server/auth/current';
import { created, paginated, parseQuery, requestId, toErrorResponse } from '@/server/lib/api';
import { createActionSchema, listActionsSchema } from '@/server/modules/actions/schema';
import { actionService } from '@/server/modules/actions/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const reqId = requestId();
  try {
    const ctx = await requireCtx(reqId);
    const { data, meta } = await actionService.list(ctx, parseQuery(req.url, listActionsSchema));
    return paginated(data, meta);
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

export async function POST(req: NextRequest) {
  const reqId = requestId();
  try {
    const ctx = await requireCtx(reqId);
    const action = await actionService.create(ctx, createActionSchema.parse(await req.json()));
    return created({ id: action.id, reference: action.reference, status: action.status });
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

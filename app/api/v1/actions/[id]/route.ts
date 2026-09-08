import { handler } from '@/server/lib/route';
import { actionService } from '@/server/modules/actions/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = handler(null, (ctx, _i, params) => actionService.getById(ctx, params.id!));

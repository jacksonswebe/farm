import { handler } from '@/server/lib/route';
import { investigationService } from '@/server/modules/investigations/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(null, (ctx, _i, params) =>
  investigationService.submit(ctx, params.id!),
);

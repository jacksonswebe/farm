import { handler } from '@/server/lib/route';
import { investigationService } from '@/server/modules/investigations/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = handler(null, (ctx, _i, params) =>
  investigationService.getById(ctx, params.id!),
);

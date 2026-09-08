import { handler } from '@/server/lib/route';
import { attachmentService } from '@/server/modules/attachments/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = handler(null, (ctx, _i, params) => attachmentService.getUrl(ctx, params.id!));

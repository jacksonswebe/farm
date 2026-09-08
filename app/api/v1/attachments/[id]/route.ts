import { handler } from '@/server/lib/route';
import { attachmentService } from '@/server/modules/attachments/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const DELETE = handler(null, (ctx, _i, params) => attachmentService.remove(ctx, params.id!));

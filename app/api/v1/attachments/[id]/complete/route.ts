import { handler } from '@/server/lib/route';
import { attachmentService } from '@/server/modules/attachments/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = handler(null, async (ctx, _i, params) => {
  const a = await attachmentService.complete(ctx, params.id!);
  return { id: a.id, fileName: a.file_name, status: a.upload_status };
});

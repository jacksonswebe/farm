import { handler } from '@/server/lib/route';
import { investigationService } from '@/server/modules/investigations/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// No dynamic segment here, but the handler signature is uniform.
export const GET = handler(null, (ctx) => investigationService.listOpen(ctx));

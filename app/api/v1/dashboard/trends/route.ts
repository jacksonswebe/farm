import { handler } from '@/server/lib/route';
import { analyticsService } from '@/server/modules/analytics/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = handler(null, (ctx) => analyticsService.trends(ctx));

import { requireCtx } from '@/server/auth/current';
import { withTenant } from '@/server/db/tenant';
import { ok, requestId, toErrorResponse } from '@/server/lib/api';
import { siteScopeFilter } from '@/server/auth/context';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const reqId = requestId();
  try {
    const ctx = await requireCtx(reqId);
    const sites = await withTenant(ctx.orgId, (tx) =>
      tx.sites.findMany({
        where: {
          is_active: true,
          ...(ctx.allSites ? {} : { id: siteScopeFilter(ctx).site_id }),
        },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
    );
    return ok(sites);
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

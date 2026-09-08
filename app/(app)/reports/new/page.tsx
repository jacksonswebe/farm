import { requireCtx } from '@/server/auth/current';
import { withTenant } from '@/server/db/tenant';
import { siteScopeFilter } from '@/server/auth/context';
import ReportForm from './report-form';

export const dynamic = 'force-dynamic';

export default async function NewReportPage() {
  const ctx = await requireCtx('new-report');
  const sites = await withTenant(ctx.orgId, (tx) =>
    tx.sites.findMany({
      where: { is_active: true, ...(ctx.allSites ? {} : { id: siteScopeFilter(ctx).site_id }) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  );

  return <ReportForm sites={sites} />;
}

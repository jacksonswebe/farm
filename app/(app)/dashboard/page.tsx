import Link from 'next/link';
import { requireCtx } from '@/server/auth/current';
import { incidentService } from '@/server/modules/incidents/service';

export const dynamic = 'force-dynamic';

function Tile({ label, value, tone = 'neutral', href }: {
  label: string; value: number; tone?: 'neutral' | 'warn' | 'alert'; href?: string;
}) {
  const toneClass =
    tone === 'alert' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-900';
  const body = (
    <div className="card p-5">
      <p className="text-sm text-slate-600">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
  // Every tile clicks through to a filtered list — no dead ends (PRD §12.4).
  return href ? <Link href={href} className="block hover:opacity-80">{body}</Link> : body;
}

export default async function DashboardPage() {
  const ctx = await requireCtx('dashboard');
  const s = await incidentService.dashboardSummary(ctx);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Safety overview</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Total events" value={s.totalEvents} href="/reports" />
        <Tile label="Open events" value={s.openEvents} href="/reports?status=SUBMITTED,ACKNOWLEDGED,INVESTIGATING,ACTIONS_PENDING" />
        <Tile label="Overdue actions" value={s.overdueActions} tone={s.overdueActions > 0 ? 'alert' : 'neutral'} />
        <Tile label="Actions due in 7 days" value={s.actionsDueNext7Days} tone="warn" />
      </div>

      <div className="card p-5">
        <h2 className="font-semibold">Next</h2>
        <p className="mt-1 text-sm text-slate-600">
          Investigations, CAPA and the full 12-tile dashboard land in Sprint 2 and 3.
          These four counters read live from the base tables, so they are never stale.
        </p>
      </div>
    </div>
  );
}

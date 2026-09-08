import Link from 'next/link';
import { requireCtx } from '@/server/auth/current';
import { analyticsService } from '@/server/modules/analytics/service';
import { Section } from '@/components/ui';
import {
  BarList, HIERARCHY_FILL, HIERARCHY_ORDER, SEVERITY_FILL, SEVERITY_ORDER,
  StackedBar, StatTile,
} from '@/components/charts';

export const dynamic = 'force-dynamic';

const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCtx('dashboard');
  const raw = await searchParams;
  const days = Number(Array.isArray(raw.days) ? raw.days[0] : (raw.days ?? 30)) || 30;
  const s = await analyticsService.summary(ctx, days);

  const delta = s.eventsThisPeriod.total - s.eventsThisPeriod.previous;
  const openTotal = Object.values(s.openByStatus).reduce((a, b) => a + b, 0);

  // The strong controls, as a share of the last 50 actions. This is the tile
  // that says whether risk is being engineered out or handed to the worker.
  const hierarchyTotal = Object.values(s.hierarchyMix).reduce((a, b) => a + b, 0);
  const strongControls =
    (s.hierarchyMix.ELIMINATION ?? 0) + (s.hierarchyMix.SUBSTITUTION ?? 0) + (s.hierarchyMix.ENGINEERING ?? 0);
  const strongShare = hierarchyTotal > 0 ? Math.round((strongControls / hierarchyTotal) * 100) : null;

  const ranges = [
    { d: 30, label: '30 days' },
    { d: 90, label: '90 days' },
    { d: 365, label: '12 months' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Safety overview</h1>
        {/* Filters in one row above the figures. */}
        <nav className="flex gap-1 rounded-lg border border-slate-300 bg-white p-1 text-sm">
          {ranges.map((r) => (
            <Link key={r.d} href={`/dashboard?days=${r.d}`}
              className={`rounded px-3 py-1 ${days === r.d ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {r.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Current state. Live from the base tables — never stale. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Events reported" value={s.eventsThisPeriod.total}
          sub={`${delta >= 0 ? '+' : ''}${delta} vs previous ${days} days`}
        />
        <StatTile label="Open events" value={openTotal} sub="Not yet closed" />
        <StatTile
          label="Overdue actions" value={s.overdueActions}
          tone={s.overdueActions > 0 ? 'alert' : 'good'}
          sub={s.overdueRate != null ? `${s.overdueRate}% of all actions` : undefined}
        />
        <StatTile
          label="Awaiting verification" value={s.awaitingVerification}
          tone={s.awaitingVerification > 0 ? 'warn' : 'neutral'}
          sub="Done, not yet checked"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Time to report" value={s.medianHoursToReport} unit="h" sub="Median, event to report" />
        <StatTile label="Time to acknowledge" value={s.medianHoursToAcknowledge} unit="h" sub="Median, report to HSE" />
        <StatTile label="Investigation turnaround" value={s.medianDaysToInvestigate} unit="d" sub="Median, assigned to approved" />
        <StatTile label="Time to close" value={s.medianDaysToClose} unit="d" sub="Median, report to closure" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Actions closed on time" value={s.actionClosureRate} unit="%"
          tone={s.actionClosureRate != null && s.actionClosureRate >= 75 ? 'good' : 'warn'}
          sub="Against the original due date"
        />
        <StatTile
          label="Leading : lagging" value={s.leadingLaggingRatio}
          tone={s.leadingLaggingRatio != null && s.leadingLaggingRatio >= 5 ? 'good' : 'warn'}
          sub="Near misses + hazards per incident"
        />
        <StatTile
          label="Strong controls" value={strongShare} unit="%"
          tone={strongShare != null && strongShare >= 40 ? 'good' : 'warn'}
          sub="Elimination, substitution or engineering"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Severity of events reported">
          <StackedBar
            data={s.severityMix} order={SEVERITY_ORDER} fills={SEVERITY_FILL}
            emptyMessage="No classified events in this period."
          />
        </Section>

        <Section title="Hierarchy of control, last 50 actions">
          <StackedBar
            data={s.hierarchyMix} order={HIERARCHY_ORDER} fills={HIERARCHY_FILL}
            emptyMessage="No actions raised yet."
          />
          <p className="mt-3 text-xs text-slate-500">
            Strongest control on the left. A mix weighted to administrative and PPE means risk is
            being managed by instructing people rather than by removing the hazard.
          </p>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Events by site">
          <BarList rows={s.bySite.map((r) => ({ label: r.site, value: r.total, secondary: r.open }))} />
        </Section>

        <Section title="Recurring root causes">
          <BarList
            rows={s.topRootCauses.map((r) => ({ label: title(r.category), value: r.count }))}
          />
          <p className="mt-3 text-xs text-slate-500">
            A cluster under one category is where a single systemic fix would prevent the most events.
          </p>
        </Section>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(s.openByStatus).length > 0 ? (
          Object.entries(s.openByStatus).map(([status, n]) => (
            <Link key={status} href={`/reports?status=${status}`} className="block hover:opacity-80">
              <StatTile label={title(status)} value={n} sub="Click through to the list" />
            </Link>
          ))
        ) : (
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="card p-6 text-center text-sm text-slate-600">
              Nothing open. Every reported event has been closed out.
            </p>
          </div>
        )}
      </div>

      {s.participation && (
        <Section title="Participation">
          <p className="text-sm text-slate-700">
            <span className="text-2xl font-bold tabular-nums">{s.participation.reporters}</span>
            {' of '}{s.participation.activeUsers} active users filed a report in the last {days} days.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Reporting participation is the leading indicator the rest of this dashboard depends on.
            If it falls, the other numbers improve for the wrong reason.
          </p>
        </Section>
      )}
    </div>
  );
}

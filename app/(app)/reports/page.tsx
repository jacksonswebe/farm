import Link from 'next/link';
import { requireCtx } from '@/server/auth/current';
import { incidentService } from '@/server/modules/incidents/service';
import { listIncidentsSchema } from '@/server/modules/incidents/schema';

export const dynamic = 'force-dynamic';

const SEVERITY_STYLE: Record<string, string> = {
  NEGLIGIBLE: 'bg-slate-100 text-slate-700',
  MINOR: 'bg-sky-100 text-sky-800',
  MODERATE: 'bg-amber-100 text-amber-800',
  MAJOR: 'bg-orange-100 text-orange-800',
  CATASTROPHIC: 'bg-red-100 text-red-800',
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCtx('reports');
  const raw = await searchParams;
  const input = listIncidentsSchema.parse(
    Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
    ),
  );
  const { data, meta } = await incidentService.list(ctx, input);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Events</h1>
        <Link href="/reports/new" className="btn-primary">Report an event</Link>
      </div>

      {data.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-medium">No events yet.</p>
          <p className="mt-1 text-sm text-slate-600">
            Reports filed by you or your team will appear here.
          </p>
          <Link href="/reports/new" className="btn-primary mt-4">Report the first one</Link>
        </div>
      ) : (
        <ul className="card divide-y divide-slate-100">
          {data.map((r) => (
            <li key={r.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-slate-500">{r.reference}</span>
                {r.severity && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[r.severity] ?? ''}`}>
                    {r.severity.toLowerCase()}
                  </span>
                )}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                  {r.status.replace(/_/g, ' ').toLowerCase()}
                </span>
              </div>
              <p className="mt-1 font-medium">{r.title}</p>
              <p className="mt-0.5 text-sm text-slate-500">
                {r.siteName} · {new Date(r.occurredAt).toLocaleString('en-GB')}
              </p>
            </li>
          ))}
        </ul>
      )}

      {meta.hasMore && (
        <Link href={`/reports?cursor=${meta.nextCursor}`} className="btn-ghost w-full">
          Load more
        </Link>
      )}
    </div>
  );
}

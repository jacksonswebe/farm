import Link from 'next/link';
import { requireCtx } from '@/server/auth/current';
import { investigationService } from '@/server/modules/investigations/service';
import { Badge, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function InvestigationsPage() {
  const ctx = await requireCtx('investigations');
  const rows = await investigationService.listOpen(ctx);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Investigations</h1>
      {rows.length === 0 ? (
        <Empty
          title="Nothing open."
          body="Investigations appear here once an HSE manager assigns one from an event."
          action={{ href: '/reports', label: 'Go to events' }}
        />
      ) : (
        <ul className="card divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/investigations/${r.id}`} className="block p-4 hover:bg-slate-50">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-slate-500">{r.reference}</span>
                  <Badge value={r.status} />
                  {r.severity && <Badge value={r.severity} kind="severity" />}
                  {r.isOverdue && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                      overdue
                    </span>
                  )}
                </div>
                <p className="mt-1 font-medium">{r.title ?? 'Untitled event'}</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {r.lead ?? 'Unassigned'} · due {new Date(r.dueAt).toLocaleDateString('en-GB')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

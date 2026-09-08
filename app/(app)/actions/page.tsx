import Link from 'next/link';
import { requireCtx } from '@/server/auth/current';
import { actionService } from '@/server/modules/actions/service';
import { listActionsSchema } from '@/server/modules/actions/schema';
import { Badge, Empty, Overdue, daysBetween } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCtx('actions');
  const raw = await searchParams;
  const input = listActionsSchema.parse(
    Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
  );
  const { data, meta } = await actionService.list(ctx, input);

  const filters = [
    { label: 'All', href: '/actions' },
    { label: 'Mine', href: '/actions?owner=me' },
    { label: 'Overdue', href: '/actions?overdue=true' },
    { label: 'Awaiting verification', href: '/actions?status=PENDING_VERIFICATION' },
  ];
  const today = new Date();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Actions</h1>

      <nav className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link key={f.href} href={f.href}
            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
            {f.label}
          </Link>
        ))}
      </nav>

      {data.length === 0 ? (
        <Empty
          title="No actions match this view."
          body="Corrective and preventive actions appear here once they are raised from an investigation finding or created directly."
        />
      ) : (
        <ul className="card divide-y divide-slate-100">
          {data.map((a) => (
            <li key={a.id}>
              <Link href={`/actions/${a.id}`} className="block p-4 hover:bg-slate-50">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-slate-500">{a.reference}</span>
                  <Badge value={a.status} />
                  {a.isOverdue && <Overdue days={daysBetween(today, new Date(a.dueDate))} />}
                  <span className="text-xs text-slate-500">{a.actionType.toLowerCase()}</span>
                </div>
                <p className="mt-1 font-medium">{a.title}</p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {a.ownerName ?? 'Unassigned'} · due {new Date(a.dueDate).toLocaleDateString('en-GB')}
                  {a.incidentReference && ` · ${a.incidentReference}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {meta.hasMore && (
        <Link href={`/actions?cursor=${meta.nextCursor}`} className="btn-ghost w-full">Load more</Link>
      )}
    </div>
  );
}

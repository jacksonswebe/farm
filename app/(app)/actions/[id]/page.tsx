import Link from 'next/link';
import { requireCtx } from '@/server/auth/current';
import { hasPermission } from '@/server/auth/permissions';
import { actionService } from '@/server/modules/actions/service';
import { Badge, HIERARCHY_LABEL, Section, daysBetween } from '@/components/ui';
import ActionControls from './action-controls';

export const dynamic = 'force-dynamic';

export default async function ActionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx('action-detail');
  const a = await actionService.getById(ctx, id);
  const owner = a.users_actions_owner_user_idTousers;
  const verifier = a.users_actions_verifier_user_idTousers;
  const pendingExtension = a.action_extensions.find((e) => !e.decided_at);
  const wasExtended = a.due_date.getTime() !== a.original_due_date.getTime();

  return (
    <div className="space-y-5">
      <div>
        {a.incidents && (
          <Link href={`/reports/${a.incidents.id}`} className="text-sm text-brand hover:underline">
            ← {a.incidents.reference}
          </Link>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-slate-500">{a.reference}</span>
          <Badge value={a.status} />
          {a.isOverdue && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
              {daysBetween(new Date(), a.due_date)} days overdue
            </span>
          )}
          {a.effectiveness && (
            <span className="text-xs text-slate-600">
              verified {a.effectiveness.replace(/_/g, ' ').toLowerCase()}
            </span>
          )}
        </div>
        <h1 className="mt-2 text-2xl font-bold">{a.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {a.action_type.toLowerCase()} · {HIERARCHY_LABEL[a.hierarchy_level]} ·{' '}
          {a.priority.toLowerCase()} priority
        </p>
      </div>

      {a.description && (
        <Section title="Detail">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{a.description}</p>
        </Section>
      )}

      <Section title="Assignment">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Owner</dt><dd className="font-medium">{owner?.full_name ?? '—'}</dd></div>
          <div><dt className="text-slate-500">Verifier</dt><dd className="font-medium">{verifier?.full_name ?? 'HSE manager'}</dd></div>
          <div>
            <dt className="text-slate-500">Due</dt>
            <dd className="font-medium">
              {a.due_date.toLocaleDateString('en-GB')}
              {wasExtended && (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  extended from {a.original_due_date.toLocaleDateString('en-GB')}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Evidence</dt>
            <dd className="font-medium">
              {a.evidence_required ? 'Required before verification' : 'Optional'}
              {a.evidence.length > 0 && ` · ${a.evidence.length} file(s)`}
            </dd>
          </div>
        </dl>
        {wasExtended && (
          <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
            On-time performance is measured against the original due date, not the extended one.
          </p>
        )}
      </Section>

      {a.action_updates.length > 0 && (
        <Section title="Progress">
          <ul className="space-y-3 text-sm">
            {a.action_updates.map((u) => (
              <li key={u.id} className="border-l-2 border-slate-200 pl-3">
                <p className="text-xs text-slate-500">
                  {u.users?.full_name ?? 'Someone'} · {new Date(u.created_at).toLocaleString('en-GB')}
                  {u.progress_percent != null && ` · ${u.progress_percent}%`}
                </p>
                <p>{u.note}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <ActionControls
        actionId={id}
        status={a.status}
        isOwner={a.owner_user_id === ctx.userId}
        canVerify={a.canVerify && hasPermission(ctx.role, 'action.verify')}
        canDecideExtension={hasPermission(ctx.role, 'action.approve_extension')}
        pendingExtension={
          pendingExtension
            ? {
                id: pendingExtension.id,
                requestedDueDate: pendingExtension.requested_due_date.toISOString().slice(0, 10),
                reason: pendingExtension.reason,
              }
            : null
        }
      />
    </div>
  );
}

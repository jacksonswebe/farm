import Link from 'next/link';
import { requireCtx } from '@/server/auth/current';
import { hasPermission } from '@/server/auth/permissions';
import { investigationService } from '@/server/modules/investigations/service';
import { Badge, HIERARCHY_LABEL, Section } from '@/components/ui';
import Workspace from './workspace';

export const dynamic = 'force-dynamic';

export default async function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx('investigation-detail');
  const inv = await investigationService.getById(ctx, id);
  const incident = inv.incidents;
  const editable = ['ASSIGNED', 'IN_PROGRESS', 'RETURNED'].includes(inv.status);

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/reports/${incident.id}`} className="text-sm text-brand hover:underline">
          ← {incident.reference}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge value={inv.status} />
          {incident.severity && <Badge value={incident.severity} kind="severity" />}
          <span className="text-sm text-slate-500">
            due {new Date(inv.due_at).toLocaleDateString('en-GB')}
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-bold">
          {incident.title ?? incident.description.slice(0, 100)}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Lead: {inv.users_investigations_lead_investigator_idTousers?.full_name ?? 'unassigned'}
          {' · '}{incident.sites.name}
        </p>
      </div>

      {inv.status === 'RETURNED' && inv.return_comments && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">Returned for rework</p>
          <p className="mt-1 text-sm text-red-700">{inv.return_comments}</p>
        </div>
      )}

      <Section title="Sequence of events">
        {inv.investigation_timeline_entries.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing recorded yet.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {inv.investigation_timeline_entries.map((t) => (
              <li key={t.id} className="flex gap-3">
                <span className="w-40 shrink-0 tabular-nums text-slate-500">
                  {new Date(t.occurred_at).toLocaleString('en-GB')}
                </span>
                <span>{t.description}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Interviews">
        {inv.investigation_interviews.length === 0 ? (
          <p className="text-sm text-slate-600">No interviews recorded.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {inv.investigation_interviews.map((i) => (
              <li key={i.id}>
                <p className="font-medium">
                  {i.interviewee_name ?? 'Named user'}
                  <span className="ml-2 text-xs text-slate-500">
                    {new Date(i.interviewed_at).toLocaleDateString('en-GB')}
                  </span>
                </p>
                <p className="text-slate-700">{i.notes}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Findings">
        {inv.findings.length === 0 ? (
          <p className="text-sm text-slate-600">No findings recorded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {inv.findings.map((f) => (
              <li key={f.id}>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs uppercase text-slate-600">
                  {f.finding_type.replace(/_/g, ' ').toLowerCase()}
                </span>
                <span className="ml-2">{f.statement}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Root causes and 5 Whys">
        {inv.root_causes.length === 0 ? (
          <p className="text-sm text-slate-600">No root cause recorded yet.</p>
        ) : (
          <div className="space-y-5">
            {inv.root_causes.map((rc) => (
              <div key={rc.id} className="rounded-lg border border-slate-200 p-4">
                <p className="text-xs uppercase text-slate-500">{rc.category.replace(/_/g, ' ').toLowerCase()}</p>
                <p className="mt-1 font-medium">{rc.statement}</p>
                {rc.root_cause_whys.length > 0 && (
                  <ol className="mt-3 space-y-2 border-l-2 border-brand/30 pl-4 text-sm">
                    {rc.root_cause_whys.map((w) => (
                      <li key={w.id}>
                        <p className="text-slate-500">{w.step}. {w.question}</p>
                        <p>{w.answer}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={`Actions (${inv.actions.length})`}>
        {inv.actions.length === 0 ? (
          <p className="text-sm text-slate-600">
            No actions yet. An investigation cannot be submitted without at least one.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {inv.actions.map((a) => (
              <li key={a.id}>
                <Link href={`/actions/${a.id}`} className="hover:underline">
                  <span className="font-mono text-xs text-slate-500">{a.reference}</span>
                  <span className="ml-2">{a.title}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {HIERARCHY_LABEL[a.hierarchy_level]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Workspace
        investigationId={id}
        incidentId={incident.id}
        status={inv.status}
        editable={editable}
        rootCauses={inv.root_causes.map((rc) => ({
          id: rc.id,
          statement: rc.statement,
          whyCount: rc.root_cause_whys.length,
        }))}
        canDecide={hasPermission(ctx.role, 'investigation.approve')}
        canCreateAction={hasPermission(ctx.role, 'action.create')}
      />
    </div>
  );
}

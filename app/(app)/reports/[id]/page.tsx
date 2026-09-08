import Link from 'next/link';
import { requireCtx } from '@/server/auth/current';
import { hasPermission } from '@/server/auth/permissions';
import { incidentService } from '@/server/modules/incidents/service';
import { actionService } from '@/server/modules/actions/service';
import { withTenant } from '@/server/db/tenant';
import { Badge, Section } from '@/components/ui';
import IncidentActions from './incident-actions';

export const dynamic = 'force-dynamic';

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx('incident-detail');
  const incident = await incidentService.getById(ctx, id);
  const { data: actions } = await actionService.list(ctx, { incidentId: id, limit: 50 });

  const investigation = await withTenant(ctx.orgId, (tx) =>
    tx.investigations.findUnique({
      where: { incident_id: id },
      select: { id: true, status: true, due_at: true },
    }),
  );

  const audit = hasPermission(ctx.role, 'audit.view')
    ? await withTenant(ctx.orgId, (tx) =>
        tx.audit_events.findMany({
          where: { entity: 'INCIDENT', entity_id: id },
          orderBy: { created_at: 'desc' },
          take: 20,
          select: { action: true, created_at: true, changes: true, actor_user_id: true },
        }),
      )
    : [];

  const reporter = incident.users_incidents_reported_by_user_idTousers;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/reports" className="text-sm text-brand hover:underline">← All events</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-slate-500">{incident.reference}</span>
          <Badge value={incident.status} />
          {incident.severity && <Badge value={incident.severity} kind="severity" />}
          {incident.risk_band && (
            <span className="text-xs text-slate-500">
              risk {incident.risk_score} · {incident.risk_band.toLowerCase()}
            </span>
          )}
          {incident.lost_time && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
              lost time
            </span>
          )}
        </div>
        <h1 className="mt-2 text-2xl font-bold">
          {incident.title ?? incident.description.slice(0, 100)}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {incident.sites.name}
          {incident.departments && ` · ${incident.departments.name}`}
          {incident.work_area && ` · ${incident.work_area}`}
          {' · '}
          {new Date(incident.occurred_at).toLocaleString('en-GB')}
          {' · reported by '}
          {incident.is_anonymous ? 'anonymous' : (reporter?.full_name ?? 'unknown')}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <a href={`/api/v1/incidents/${id}/export`} className="btn-primary">
          Download evidence pack (PDF)
        </a>
        <p className="self-center text-xs text-slate-500">
          Everything on this event in one auditable document. Producing it is recorded in the
          audit trail.
        </p>
      </div>

      <Section title="What happened">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{incident.description}</p>
        {incident.immediate_action && (
          <>
            <h3 className="mt-4 text-sm font-semibold">Immediate action taken</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm">{incident.immediate_action}</p>
          </>
        )}
      </Section>

      {incident.incident_persons.length > 0 && (
        <Section title="People involved">
          {incident.sensitiveRedacted && (
            <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
              Injury and health detail is hidden. It is visible to HSE, the assigned investigator,
              and the person the record is about.
            </p>
          )}
          <ul className="divide-y divide-slate-100 text-sm">
            {incident.incident_persons.map((p) => (
              <li key={p.id} className="py-2">
                <span className="font-medium">{p.full_name ?? 'Named user'}</span>
                <span className="ml-2 text-xs uppercase text-slate-500">
                  {p.involvement.replace(/_/g, ' ').toLowerCase()}
                </span>
                {p.treatment && (
                  <span className="ml-2 text-xs text-slate-600">
                    {p.treatment.replace(/_/g, ' ').toLowerCase()}
                    {p.days_lost != null && ` · ${p.days_lost} days lost`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Investigation"
        right={
          investigation ? (
            <Link href={`/investigations/${investigation.id}`} className="text-sm text-brand hover:underline">
              Open workspace →
            </Link>
          ) : null
        }
      >
        {investigation ? (
          <p className="text-sm">
            <Badge value={investigation.status} />
            <span className="ml-2 text-slate-600">
              due {new Date(investigation.due_at).toLocaleDateString('en-GB')}
            </span>
          </p>
        ) : (
          <p className="text-sm text-slate-600">
            {incident.investigation_required
              ? 'An investigation is required for this event and has not been assigned yet.'
              : 'No investigation required.'}
          </p>
        )}
      </Section>

      <Section title={`Actions (${actions.length})`}>
        {actions.length === 0 ? (
          <p className="text-sm text-slate-600">No corrective or preventive actions yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {actions.map((a) => (
              <li key={a.id} className="py-2">
                <Link href={`/actions/${a.id}`} className="block hover:opacity-75">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{a.reference}</span>
                    <Badge value={a.status} />
                    {a.isOverdue && (
                      <span className="text-xs font-semibold text-red-700">overdue</span>
                    )}
                  </div>
                  <p className="text-sm">{a.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <IncidentActions
        incidentId={id}
        status={incident.status}
        hasInvestigation={Boolean(investigation)}
        canAssign={hasPermission(ctx.role, 'investigation.assign')}
        canClose={hasPermission(ctx.role, 'incident.close')}
      />

      {audit.length > 0 && (
        <Section title="History">
          <ul className="space-y-2 text-xs text-slate-600">
            {audit.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-36 shrink-0 tabular-nums">
                  {new Date(e.created_at).toLocaleString('en-GB')}
                </span>
                <span className="font-medium">{e.action.replace(/_/g, ' ').toLowerCase()}</span>
                <span className="truncate">
                  {e.changes ? JSON.stringify(e.changes) : ''}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

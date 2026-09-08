'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Tab = 'timeline' | 'interview' | 'finding' | 'rootcause' | 'whys' | 'action';

const FINDING_TYPES = [
  ['IMMEDIATE_CAUSE', 'Immediate cause'],
  ['UNDERLYING_CAUSE', 'Underlying cause'],
  ['ROOT_CAUSE', 'Root cause'],
  ['OBSERVATION', 'Observation'],
] as const;

const RC_CATEGORIES = [
  ['MANAGEMENT_SYSTEM', 'Management system'],
  ['PROCESS', 'Process'],
  ['EQUIPMENT', 'Equipment'],
  ['ENVIRONMENT', 'Environment'],
  ['PEOPLE', 'People'],
  ['EXTERNAL', 'External'],
] as const;

const HIERARCHY = [
  ['ELIMINATION', 'Elimination — remove the hazard'],
  ['SUBSTITUTION', 'Substitution — replace it'],
  ['ENGINEERING', 'Engineering control — isolate people from it'],
  ['ADMINISTRATIVE', 'Administrative — change how people work'],
  ['PPE', 'PPE — protect the person'],
] as const;

function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function Workspace({
  investigationId, incidentId, status, editable, rootCauses, canDecide, canCreateAction,
}: {
  investigationId: string;
  incidentId: string;
  status: string;
  editable: boolean;
  rootCauses: { id: string; statement: string; whyCount: number }[];
  canDecide: boolean;
  canCreateAction: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function post(path: string, body: unknown, method = 'POST') {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(path, {
        method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.details?.[0]?.message ?? json?.error?.message ?? 'That did not work.');
        return null;
      }
      router.refresh();
      return json;
    } finally {
      setBusy(false);
    }
  }

  // --- individual forms -------------------------------------------------
  const [tl, setTl] = useState({ occurredAt: localNow(), description: '' });
  const [iv, setIv] = useState({ intervieweeName: '', interviewedAt: localNow(), notes: '' });
  const [fn, setFn] = useState({ findingType: 'ROOT_CAUSE', statement: '' });
  const [rc, setRc] = useState({ problemStatement: '', statement: '', category: 'MANAGEMENT_SYSTEM' });
  const [whyTarget, setWhyTarget] = useState(rootCauses[0]?.id ?? '');
  const [whys, setWhys] = useState<{ question: string; answer: string }[]>([
    { question: 'Why did this happen?', answer: '' },
    { question: 'Why?', answer: '' },
    { question: 'Why?', answer: '' },
  ]);
  const [act, setAct] = useState({
    title: '', actionType: 'CORRECTIVE', hierarchyLevel: 'ENGINEERING',
    ownerUserId: '', dueDate: '',
  });
  const [returnComments, setReturnComments] = useState('');
  const [returning, setReturning] = useState(false);

  const tabs: [Tab, string][] = [
    ['timeline', 'Timeline entry'],
    ['interview', 'Interview'],
    ['finding', 'Finding'],
    ['rootcause', 'Root cause'],
    ['whys', '5 Whys'],
  ];
  if (canCreateAction) tabs.push(['action', 'Action']);

  return (
    <div className="card p-5">
      <h2 className="mb-3 font-semibold">
        {editable ? 'Record findings' : 'This investigation is read-only'}
      </h2>

      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>}

      {editable && (
        <>
          <nav className="mb-4 flex flex-wrap gap-2">
            {tabs.map(([t, label]) => (
              <button key={t} onClick={() => setTab(tab === t ? null : t)}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  tab === t ? 'border-brand bg-brand-light' : 'border-slate-300 bg-white hover:bg-slate-50'
                }`}>
                {label}
              </button>
            ))}
          </nav>

          {tab === 'timeline' && (
            <div className="space-y-3">
              <input type="datetime-local" className="field" value={tl.occurredAt}
                onChange={(e) => setTl({ ...tl, occurredAt: e.target.value })} />
              <textarea rows={2} className="field" placeholder="What happened at this moment?"
                value={tl.description} onChange={(e) => setTl({ ...tl, description: e.target.value })} />
              <button className="btn-primary" disabled={busy || tl.description.trim().length < 3}
                onClick={async () => {
                  if (await post(`/api/v1/investigations/${investigationId}/timeline`, {
                    occurredAt: new Date(tl.occurredAt).toISOString(), description: tl.description,
                  })) setTl({ ...tl, description: '' });
                }}>Add to timeline</button>
            </div>
          )}

          {tab === 'interview' && (
            <div className="space-y-3">
              <input className="field" placeholder="Who was interviewed"
                value={iv.intervieweeName} onChange={(e) => setIv({ ...iv, intervieweeName: e.target.value })} />
              <input type="datetime-local" className="field" value={iv.interviewedAt}
                onChange={(e) => setIv({ ...iv, interviewedAt: e.target.value })} />
              <textarea rows={3} className="field" placeholder="What they said"
                value={iv.notes} onChange={(e) => setIv({ ...iv, notes: e.target.value })} />
              <button className="btn-primary" disabled={busy || iv.notes.trim().length < 3}
                onClick={async () => {
                  if (await post(`/api/v1/investigations/${investigationId}/interviews`, {
                    intervieweeName: iv.intervieweeName,
                    interviewedAt: new Date(iv.interviewedAt).toISOString(), notes: iv.notes,
                  })) setIv({ ...iv, intervieweeName: '', notes: '' });
                }}>Record interview</button>
            </div>
          )}

          {tab === 'finding' && (
            <div className="space-y-3">
              <select className="field" value={fn.findingType}
                onChange={(e) => setFn({ ...fn, findingType: e.target.value })}>
                {FINDING_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <textarea rows={2} className="field" placeholder="State the finding"
                value={fn.statement} onChange={(e) => setFn({ ...fn, statement: e.target.value })} />
              <button className="btn-primary" disabled={busy || fn.statement.trim().length < 10}
                onClick={async () => {
                  if (await post(`/api/v1/investigations/${investigationId}/findings`, fn))
                    setFn({ ...fn, statement: '' });
                }}>Add finding</button>
            </div>
          )}

          {tab === 'rootcause' && (
            <div className="space-y-3">
              <textarea rows={2} className="field" placeholder="The problem being explained"
                value={rc.problemStatement}
                onChange={(e) => setRc({ ...rc, problemStatement: e.target.value })} />
              <textarea rows={2} className="field" placeholder="The root cause — a system condition, not a person"
                value={rc.statement} onChange={(e) => setRc({ ...rc, statement: e.target.value })} />
              <select className="field" value={rc.category}
                onChange={(e) => setRc({ ...rc, category: e.target.value })}>
                {RC_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button className="btn-primary"
                disabled={busy || rc.statement.trim().length < 10 || rc.problemStatement.trim().length < 10}
                onClick={async () => {
                  const res = await post(`/api/v1/investigations/${investigationId}/root-causes`, rc);
                  if (res) {
                    // Advisory guardrail: recorded either way, but said out loud.
                    if (res.data?.blameWarning) setNotice(res.data.blameWarning);
                    setRc({ ...rc, problemStatement: '', statement: '' });
                  }
                }}>Add root cause</button>
            </div>
          )}

          {tab === 'whys' && (
            <div className="space-y-3">
              {rootCauses.length === 0 ? (
                <p className="text-sm text-slate-600">Add a root cause first, then build its why chain.</p>
              ) : (
                <>
                  <select className="field" value={whyTarget} onChange={(e) => setWhyTarget(e.target.value)}>
                    {rootCauses.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.statement.slice(0, 70)} ({r.whyCount} whys)
                      </option>
                    ))}
                  </select>
                  {whys.map((w, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 p-3">
                      <input className="field mb-2" value={w.question} placeholder={`Why ${i + 1}`}
                        onChange={(e) => {
                          const next = [...whys]; next[i] = { ...w, question: e.target.value }; setWhys(next);
                        }} />
                      <input className="field" value={w.answer} placeholder="Because…"
                        onChange={(e) => {
                          const next = [...whys]; next[i] = { ...w, answer: e.target.value }; setWhys(next);
                        }} />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    {whys.length < 7 && (
                      <button className="btn-ghost"
                        onClick={() => setWhys([...whys, { question: 'Why?', answer: '' }])}>
                        + Another why
                      </button>
                    )}
                    {whys.length > 3 && (
                      <button className="btn-ghost" onClick={() => setWhys(whys.slice(0, -1))}>
                        Remove last
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Three is the minimum. Stopping at one or two usually lands on who was nearest,
                    not on what allowed it.
                  </p>
                  <button className="btn-primary"
                    disabled={busy || whys.some((w) => w.answer.trim().length < 3)}
                    onClick={() => post(`/api/v1/root-causes/${whyTarget}/whys`, {
                      steps: whys.map((w, i) => ({ step: i + 1, question: w.question, answer: w.answer })),
                    }, 'PUT')}>
                    Save the chain
                  </button>
                </>
              )}
            </div>
          )}

          {tab === 'action' && (
            <div className="space-y-3">
              <input className="field" placeholder="What must be done"
                value={act.title} onChange={(e) => setAct({ ...act, title: e.target.value })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <select className="field" value={act.actionType}
                  onChange={(e) => setAct({ ...act, actionType: e.target.value })}>
                  <option value="CORRECTIVE">Corrective — fix this occurrence</option>
                  <option value="PREVENTIVE">Preventive — stop it recurring</option>
                </select>
                <input type="date" className="field" value={act.dueDate}
                  onChange={(e) => setAct({ ...act, dueDate: e.target.value })} />
              </div>
              <select className="field" value={act.hierarchyLevel}
                onChange={(e) => setAct({ ...act, hierarchyLevel: e.target.value })}>
                {HIERARCHY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <p className="text-xs text-slate-500">
                Hierarchy of control is mandatory. An organisation whose actions are all PPE and
                administrative is not controlling risk — the dashboard makes that visible.
              </p>
              <input className="field" placeholder="Owner user id"
                value={act.ownerUserId} onChange={(e) => setAct({ ...act, ownerUserId: e.target.value })} />
              <button className="btn-primary"
                disabled={busy || act.title.trim().length < 5 || !act.ownerUserId || !act.dueDate}
                onClick={async () => {
                  if (await post('/api/v1/actions', { ...act, incidentId, investigationId }))
                    setAct({ ...act, title: '', ownerUserId: '' });
                }}>Create action</button>
            </div>
          )}

          <div className="mt-5 border-t border-slate-200 pt-4">
            <button className="btn-primary" disabled={busy}
              onClick={() => post(`/api/v1/investigations/${investigationId}/submit`, {})}>
              Submit for approval
            </button>
            <p className="mt-2 text-xs text-slate-500">
              Requires at least one finding, one root cause and one action.
            </p>
          </div>
        </>
      )}

      {status === 'SUBMITTED' && canDecide && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            This investigation is awaiting your decision. It cannot be approved by its own lead.
          </p>
          {returning ? (
            <>
              <textarea rows={3} className="field" placeholder="What needs to change before resubmission?"
                value={returnComments} onChange={(e) => setReturnComments(e.target.value)} />
              <div className="flex gap-2">
                <button className="btn-ghost flex-1" onClick={() => setReturning(false)}>Cancel</button>
                <button className="btn-primary flex-1" disabled={busy || returnComments.trim().length < 10}
                  onClick={() => post(`/api/v1/investigations/${investigationId}/return`,
                    { comments: returnComments })}>
                  Return for rework
                </button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setReturning(true)}>Return for rework</button>
              <button className="btn-primary flex-1" disabled={busy}
                onClick={() => post(`/api/v1/investigations/${investigationId}/approve`, {})}>
                Approve
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

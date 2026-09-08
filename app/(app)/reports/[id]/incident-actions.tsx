'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The state transitions available on an event, gated by both role and status.
 * The server enforces all of this again — this only avoids showing a control
 * that would fail.
 */
export default function IncidentActions({
  incidentId, status, hasInvestigation, canAssign, canClose,
}: {
  incidentId: string; status: string; hasInvestigation: boolean;
  canAssign: boolean; canClose: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [statement, setStatement] = useState('');
  const [investigatorId, setInvestigatorId] = useState('');
  const [assigning, setAssigning] = useState(false);

  async function post(path: string, body: unknown) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? 'That did not work.');
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const showAssign = canAssign && !hasInvestigation && !['CLOSED', 'REJECTED'].includes(status);
  const showClose = canClose && ['ACTIONS_PENDING', 'PENDING_CLOSURE'].includes(status);
  if (!showAssign && !showClose) return null;

  return (
    <div className="card p-5">
      <h2 className="mb-3 font-semibold">Next step</h2>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {showAssign && (assigning ? (
        <div className="space-y-3">
          <label className="label" htmlFor="inv">Investigator user id</label>
          <input id="inv" className="field" value={investigatorId} placeholder="uuid"
            onChange={(e) => setInvestigatorId(e.target.value)} />
          <p className="text-xs text-slate-500">
            The due date is set automatically from severity: 2 days for catastrophic,
            5 for major, 7 for moderate, 14 otherwise.
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setAssigning(false)}>Cancel</button>
            <button className="btn-primary flex-1" disabled={busy || !investigatorId}
              onClick={async () => {
                if (await post(`/api/v1/incidents/${incidentId}/investigation`,
                  { leadInvestigatorId: investigatorId })) setAssigning(false);
              }}>
              Assign
            </button>
          </div>
        </div>
      ) : (
        <button className="btn-primary" onClick={() => setAssigning(true)}>Assign an investigator</button>
      ))}

      {showClose && (closing ? (
        <div className="space-y-3">
          <label className="label" htmlFor="stmt">Closure statement</label>
          <textarea id="stmt" rows={3} className="field" value={statement}
            placeholder="What was done, and why this event is now closed."
            onChange={(e) => setStatement(e.target.value)} />
          <p className="text-xs text-slate-500">
            Every linked action must be verified or cancelled first.
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setClosing(false)}>Cancel</button>
            <button className="btn-primary flex-1" disabled={busy || statement.trim().length < 10}
              onClick={() => post(`/api/v1/incidents/${incidentId}/close`, { closureStatement: statement })}>
              Close event
            </button>
          </div>
        </div>
      ) : (
        <button className="btn-primary mt-2" onClick={() => setClosing(true)}>Close this event</button>
      ))}
    </div>
  );
}

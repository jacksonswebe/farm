'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const EFFECTIVENESS = [
  ['EFFECTIVE', 'Effective — the risk is controlled'],
  ['PARTIALLY_EFFECTIVE', 'Partially effective'],
  ['NOT_EFFECTIVE', 'Not effective — raises a follow-up'],
] as const;

export default function ActionControls({
  actionId, status, isOwner, canVerify, canDecideExtension, pendingExtension,
}: {
  actionId: string;
  status: string;
  isOwner: boolean;
  canVerify: boolean;
  canDecideExtension: boolean;
  pendingExtension: { id: string; requestedDueDate: string; reason: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<'progress' | 'submit' | 'verify' | 'extend' | null>(null);
  const [note, setNote] = useState('');
  const [effectiveness, setEffectiveness] = useState('EFFECTIVE');
  const [comments, setComments] = useState('');
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState('');

  async function post(path: string, body: unknown) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.details?.[0]?.message ?? json?.error?.message ?? 'That did not work.');
        return null;
      }
      router.refresh();
      setPanel(null);
      return json;
    } finally {
      setBusy(false);
    }
  }

  const open = ['OPEN', 'IN_PROGRESS', 'REJECTED'].includes(status);
  const nothingToDo = !open && !canVerify && !pendingExtension;
  if (nothingToDo) return null;

  return (
    <div className="card space-y-3 p-5">
      <h2 className="font-semibold">What happens next</h2>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      {pendingExtension && canDecideExtension && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Extension requested</p>
          <p className="mt-1 text-sm text-amber-800">
            To {new Date(pendingExtension.requestedDueDate).toLocaleDateString('en-GB')} —{' '}
            {pendingExtension.reason}
          </p>
          <div className="mt-3 flex gap-2">
            <button className="btn-ghost flex-1" disabled={busy}
              onClick={() => post(`/api/v1/extensions/${pendingExtension.id}/decide`, { approved: false })}>
              Decline
            </button>
            <button className="btn-primary flex-1" disabled={busy}
              onClick={() => post(`/api/v1/extensions/${pendingExtension.id}/decide`, { approved: true })}>
              Approve
            </button>
          </div>
        </div>
      )}

      {open && isOwner && panel === null && (
        <div className="flex flex-wrap gap-2">
          {status === 'OPEN' && (
            <button className="btn-ghost" disabled={busy}
              onClick={() => post(`/api/v1/actions/${actionId}/start`, {})}>Start work</button>
          )}
          <button className="btn-ghost" onClick={() => setPanel('progress')}>Add progress</button>
          <button className="btn-ghost" onClick={() => setPanel('extend')}>Request extension</button>
          <button className="btn-primary" onClick={() => setPanel('submit')}>Mark complete</button>
        </div>
      )}

      {panel === 'progress' && (
        <div className="space-y-3">
          <textarea rows={3} className="field" placeholder="What has been done since the last update?"
            value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setPanel(null)}>Cancel</button>
            <button className="btn-primary flex-1" disabled={busy || note.trim().length < 3}
              onClick={async () => {
                if (await post(`/api/v1/actions/${actionId}/updates`, { note })) setNote('');
              }}>Save update</button>
          </div>
        </div>
      )}

      {panel === 'submit' && (
        <div className="space-y-3">
          <textarea rows={3} className="field" placeholder="What was done to complete this action?"
            value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="text-xs text-slate-500">
            Someone other than you must verify this. If evidence is required and none is attached,
            submission is refused.
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setPanel(null)}>Cancel</button>
            <button className="btn-primary flex-1" disabled={busy}
              onClick={() => post(`/api/v1/actions/${actionId}/submit`, { note, evidenceAttachmentIds: [] })}>
              Submit for verification
            </button>
          </div>
        </div>
      )}

      {panel === 'extend' && (
        <div className="space-y-3">
          <input type="date" className="field" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          <textarea rows={2} className="field" placeholder="Why is more time needed?"
            value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-xs text-slate-500">
            The original due date is kept — on-time performance is still measured against it.
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setPanel(null)}>Cancel</button>
            <button className="btn-primary flex-1" disabled={busy || !newDate || reason.trim().length < 10}
              onClick={() => post(`/api/v1/actions/${actionId}/extensions`,
                { requestedDueDate: newDate, reason })}>
              Request extension
            </button>
          </div>
        </div>
      )}

      {canVerify && panel !== 'verify' && (
        <button className="btn-primary" onClick={() => setPanel('verify')}>Verify this action</button>
      )}

      {panel === 'verify' && (
        <div className="space-y-3">
          <select className="field" value={effectiveness} onChange={(e) => setEffectiveness(e.target.value)}>
            {EFFECTIVENESS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <textarea rows={2} className="field" placeholder="Verification comments"
            value={comments} onChange={(e) => setComments(e.target.value)} />
          {effectiveness === 'NOT_EFFECTIVE' && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              A follow-up action will be raised automatically and assigned to the same owner.
            </p>
          )}
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setPanel(null)}>Cancel</button>
            <button className="btn-primary flex-1" disabled={busy}
              onClick={async () => {
                const res = await post(`/api/v1/actions/${actionId}/verify`, { effectiveness, comments });
                if (res?.data?.followUp) {
                  setNotice(`Follow-up ${res.data.followUp.reference} raised.`);
                } else if (res?.data?.incidentReadyToClose) {
                  setNotice('That was the last open action — the event is ready to close.');
                }
              }}>
              Record verification
            </button>
          </div>
        </div>
      )}

      {!open && !canVerify && status === 'PENDING_VERIFICATION' && (
        <p className="text-sm text-slate-600">
          Waiting on verification by someone other than the owner.
        </p>
      )}
    </div>
  );
}

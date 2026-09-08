'use client';

import { useState } from 'react';

const TYPES = [
  { value: 'HAZARD', label: 'Hazard', hint: 'Something unsafe right now' },
  { value: 'NEAR_MISS', label: 'Near miss', hint: 'Almost went wrong' },
  { value: 'OBSERVATION', label: 'Observation', hint: 'Worth someone knowing' },
] as const;

function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function AnonymousForm({ siteToken }: { siteToken: string }) {
  const [reportType, setReportType] = useState<string>('HAZARD');
  const [description, setDescription] = useState('');
  const [workArea, setWorkArea] = useState('');
  const [occurredAt, setOccurredAt] = useState(localNow());
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/public/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          siteToken, reportType, description,
          occurredAt: new Date(occurredAt).toISOString(),
          workArea: workArea || undefined,
          contact: contact || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.details?.[0]?.message ?? body?.error?.message ?? 'Could not submit.');
        return;
      }
      setReference(body.data.reference);
    } catch {
      setError('Could not reach the server. Your report was not submitted.');
    } finally {
      setBusy(false);
    }
  }

  if (reference) {
    return (
      <div className="card p-8 text-center">
        <div className="text-4xl">✓</div>
        <h2 className="mt-3 text-xl font-bold">Thank you — it has been sent</h2>
        <p className="mt-2 text-sm text-slate-600">Reference</p>
        <p className="mt-1 font-mono text-2xl font-bold text-brand">{reference}</p>
        <p className="mt-3 text-sm text-slate-600">
          The safety team has been notified. Screenshot this reference if you want to follow it up.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5 pb-12">
      <fieldset>
        <legend className="label">What are you reporting?</legend>
        <div className="grid gap-2">
          {TYPES.map((t) => (
            <button key={t.value} type="button" onClick={() => setReportType(t.value)}
              className={`rounded-lg border p-3 text-left transition ${
                reportType === t.value
                  ? 'border-brand bg-brand-light ring-2 ring-brand/30'
                  : 'border-slate-300 bg-white hover:bg-slate-50'
              }`}>
              <span className="block font-semibold">{t.label}</span>
              <span className="block text-xs text-slate-600">{t.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="d">What did you see?</label>
        <textarea id="d" required rows={5} className="field" value={description}
          placeholder="Describe what you saw and where."
          onChange={(e) => setDescription(e.target.value)} />
        <p className="mt-1 text-xs text-slate-500">
          {description.trim().length < 20
            ? `${20 - description.trim().length} more characters needed`
            : 'Thank you — that is enough to act on.'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="w">Where exactly?</label>
          <input id="w" className="field" value={workArea} placeholder="e.g. Block C, level 2"
            onChange={(e) => setWorkArea(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="o">When</label>
          <input id="o" type="datetime-local" className="field" max={localNow()} value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <label className="label" htmlFor="c">Contact (optional)</label>
        <input id="c" className="field" value={contact} placeholder="Only if you want a reply"
          onChange={(e) => setContact(e.target.value)} />
        <p className="mt-2 text-xs text-slate-600">
          Leave this blank to stay completely anonymous. If you do fill it in it is encrypted,
          and only the HSE manager can read it.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <button type="submit" className="btn-primary w-full"
        disabled={busy || description.trim().length < 20}>
        {busy ? 'Sending…' : 'Send report'}
      </button>
      <p className="text-center text-xs text-slate-500">
        Your name is not recorded and your account is not used.
      </p>
    </form>
  );
}

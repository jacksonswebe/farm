'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The 60-second report (PRD S2.1).
 *
 * Only five fields are required. Everything else is behind "Add detail", so
 * the common case — a worker on a site with one hand free — is as short as
 * it can be. Optional detail that blocks submission is detail that stops the
 * report being filed at all.
 */
const TYPES = [
  { value: 'HAZARD', label: 'Hazard', hint: 'Something unsafe that could cause harm' },
  { value: 'NEAR_MISS', label: 'Near miss', hint: 'Almost happened, no one hurt' },
  { value: 'INCIDENT', label: 'Incident', hint: 'It happened — injury or damage' },
  { value: 'OBSERVATION', label: 'Observation', hint: 'Something worth noting' },
] as const;

const SEVERITIES = [
  { value: 'NEGLIGIBLE', label: 'Negligible' },
  { value: 'MINOR', label: 'Minor' },
  { value: 'MODERATE', label: 'Moderate' },
  { value: 'MAJOR', label: 'Major' },
  { value: 'CATASTROPHIC', label: 'Catastrophic' },
] as const;

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function ReportForm({ sites }: { sites: { id: string; name: string }[] }) {
  const router = useRouter();
  const [reportType, setReportType] = useState<string>('HAZARD');
  const [description, setDescription] = useState('');
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [occurredAt, setOccurredAt] = useState(localNow());
  const [severity, setSeverity] = useState<string>('MINOR');
  const [workArea, setWorkArea] = useState('');
  const [immediateAction, setImmediateAction] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/incidents', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Makes an offline replay safe to retry: the server resolves a
          // duplicate to the original record instead of creating a second.
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          reportType,
          description,
          siteId,
          occurredAt: new Date(occurredAt).toISOString(),
          severity,
          workArea: workArea || undefined,
          immediateAction: immediateAction || undefined,
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

  // The confirmation screen exists so the reporter can screenshot the
  // reference — that is how it gets quoted on site and over WhatsApp.
  if (reference) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <div className="text-4xl">✓</div>
        <h1 className="mt-3 text-xl font-bold">Report submitted</h1>
        <p className="mt-2 text-sm text-slate-600">Your reference number is</p>
        <p className="mt-1 font-mono text-2xl font-bold text-brand">{reference}</p>
        <p className="mt-3 text-sm text-slate-600">
          The HSE team has been notified. Screenshot this reference.
        </p>
        <div className="mt-6 flex gap-2">
          <button className="btn-ghost flex-1" onClick={() => { setReference(null); setDescription(''); }}>
            Report another
          </button>
          <button className="btn-primary flex-1" onClick={() => router.push('/reports')}>
            View events
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-lg space-y-5">
      <h1 className="text-2xl font-bold">Report an event</h1>

      <fieldset>
        <legend className="label">What are you reporting?</legend>
        <div className="grid grid-cols-2 gap-2">
          {TYPES.map((t) => (
            <button
              key={t.value} type="button" onClick={() => setReportType(t.value)}
              className={`rounded-lg border p-3 text-left transition ${
                reportType === t.value
                  ? 'border-brand bg-brand-light ring-2 ring-brand/30'
                  : 'border-slate-300 bg-white hover:bg-slate-50'
              }`}
            >
              <span className="block font-semibold">{t.label}</span>
              <span className="block text-xs text-slate-600">{t.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="description">What happened?</label>
        <textarea
          id="description" required rows={4} className="field" value={description}
          placeholder="Describe what you saw, where, and who was involved."
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          {description.trim().length < 20
            ? `${20 - description.trim().length} more characters needed`
            : 'Good — enough detail to investigate.'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="site">Site</label>
          <select id="site" required className="field" value={siteId}
            onChange={(e) => setSiteId(e.target.value)}>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="occurredAt">When</label>
          <input id="occurredAt" type="datetime-local" required className="field"
            max={localNow()} value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="severity">How serious?</label>
        <select id="severity" className="field" value={severity}
          onChange={(e) => setSeverity(e.target.value)}>
          {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Your best guess. The HSE team confirms it.
        </p>
      </div>

      {!showDetail ? (
        <button type="button" className="text-sm font-medium text-brand underline"
          onClick={() => setShowDetail(true)}>
          + Add detail (optional)
        </button>
      ) : (
        <div className="space-y-4 rounded-lg border border-slate-200 p-4">
          <div>
            <label className="label" htmlFor="workArea">Exact location</label>
            <input id="workArea" className="field" value={workArea}
              placeholder="e.g. Block C, level 2 slab edge"
              onChange={(e) => setWorkArea(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="immediateAction">What was done immediately?</label>
            <textarea id="immediateAction" rows={2} className="field" value={immediateAction}
              placeholder="e.g. Area barricaded, work stopped"
              onChange={(e) => setImmediateAction(e.target.value)} />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={busy || description.trim().length < 20}>
        {busy ? 'Submitting…' : 'Submit report'}
      </button>
    </form>
  );
}

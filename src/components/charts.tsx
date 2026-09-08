/**
 * Chart primitives for the safety dashboard.
 *
 * Two encodings, both sequential rather than categorical, because both
 * quantities are ordered magnitudes rather than identities:
 *   severity  — how bad, amber -> deep red
 *   hierarchy — how strong the control is, pale -> deep teal
 *
 * Sequential ramps are validated on lightness monotonicity, not adjacent
 * CVD separation: lightness carries the order, so they survive any colour
 * vision. Verified monotonic with a smallest step of 0.110 (severity) and
 * 0.098 (hierarchy) in OKLab L.
 *
 * The pale end of each ramp falls below 3:1 against a white surface, so
 * every segment carries a visible label — colour never carries meaning alone.
 */

export const SEVERITY_ORDER = ['NEGLIGIBLE', 'MINOR', 'MODERATE', 'MAJOR', 'CATASTROPHIC'] as const;
export const SEVERITY_FILL: Record<string, string> = {
  NEGLIGIBLE: '#fed7aa',
  MINOR: '#fb923c',
  MODERATE: '#ef4444',
  MAJOR: '#b91c1c',
  CATASTROPHIC: '#7f1d1d',
  UNCLASSIFIED: '#e2e8f0',
};

/** Strongest control first — the order is the point of the hierarchy. */
export const HIERARCHY_ORDER = [
  'ELIMINATION', 'SUBSTITUTION', 'ENGINEERING', 'ADMINISTRATIVE', 'PPE',
] as const;
export const HIERARCHY_FILL: Record<string, string> = {
  ELIMINATION: '#134e4a',
  SUBSTITUTION: '#0f766e',
  ENGINEERING: '#14b8a6',
  ADMINISTRATIVE: '#5eead4',
  PPE: '#ccfbf1',
};

const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export function StatTile({
  label, value, unit, sub, tone = 'neutral',
}: {
  label: string;
  value: number | string | null;
  unit?: string;
  sub?: string;
  tone?: 'neutral' | 'warn' | 'alert' | 'good';
}) {
  const toneClass = {
    neutral: 'text-slate-900',
    good: 'text-emerald-700',
    warn: 'text-amber-700',
    alert: 'text-red-700',
  }[tone];

  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1.5 text-3xl font-bold tabular-nums ${toneClass}`}>
        {value ?? '—'}
        {value != null && unit && <span className="ml-1 text-base font-medium text-slate-500">{unit}</span>}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

/**
 * A stacked proportion bar. Segments are separated by a 2px surface gap so
 * adjacent fills never touch, and each is labelled beneath.
 */
export function StackedBar({
  data, order, fills, emptyMessage,
}: {
  data: Record<string, number>;
  order: readonly string[];
  fills: Record<string, string>;
  emptyMessage: string;
}) {
  const keys = order.filter((k) => (data[k] ?? 0) > 0);
  const extra = Object.keys(data).filter((k) => !order.includes(k) && data[k]! > 0);
  const all = [...keys, ...extra];
  const total = all.reduce((sum, k) => sum + (data[k] ?? 0), 0);

  if (total === 0) return <p className="text-sm text-slate-600">{emptyMessage}</p>;

  return (
    <div>
      <div className="flex h-6 gap-0.5 overflow-hidden rounded" role="img"
        aria-label={all.map((k) => `${title(k)} ${data[k]}`).join(', ')}>
        {all.map((k) => (
          <div key={k} style={{ width: `${((data[k] ?? 0) / total) * 100}%`, background: fills[k] ?? '#e2e8f0' }}
            className="first:rounded-l last:rounded-r" />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {all.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm ring-1 ring-black/5"
              style={{ background: fills[k] ?? '#e2e8f0' }} />
            <span className="text-slate-600">{title(k)}</span>
            <span className="font-semibold tabular-nums text-slate-900">{data[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Single-series magnitude comparison. One hue, no legend — the title names it. */
export function BarList({
  rows, valueLabel,
}: {
  rows: { label: string; value: number; secondary?: number; fill?: string }[];
  valueLabel?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-slate-600">Nothing to compare yet.</p>;

  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{r.label}</span>
            <span className="shrink-0 font-semibold tabular-nums">
              {r.value}
              {r.secondary != null && (
                <span className="ml-1.5 text-xs font-normal text-slate-500">
                  {r.secondary} open
                </span>
              )}
            </span>
          </div>
          <div className="mt-1 h-2 rounded bg-slate-100">
            {/* 4px rounded data-end, anchored to the baseline. */}
            <div className="h-2 rounded" style={{
              width: `${Math.max(2, (r.value / max) * 100)}%`,
              background: r.fill ?? '#0f766e',
            }} />
          </div>
          {valueLabel && <span className="sr-only">{valueLabel}</span>}
        </li>
      ))}
    </ul>
  );
}

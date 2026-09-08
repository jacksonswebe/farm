import Link from 'next/link';

export const SEVERITY_STYLE: Record<string, string> = {
  NEGLIGIBLE: 'bg-slate-100 text-slate-700',
  MINOR: 'bg-sky-100 text-sky-800',
  MODERATE: 'bg-amber-100 text-amber-800',
  MAJOR: 'bg-orange-100 text-orange-800',
  CATASTROPHIC: 'bg-red-100 text-red-800',
};

const STATUS_STYLE: Record<string, string> = {
  VERIFIED_CLOSED: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-emerald-100 text-emerald-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  PENDING_VERIFICATION: 'bg-violet-100 text-violet-800',
  SUBMITTED: 'bg-sky-100 text-sky-800',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  INVESTIGATING: 'bg-amber-100 text-amber-800',
  ACTIONS_PENDING: 'bg-amber-100 text-amber-800',
  RETURNED: 'bg-red-100 text-red-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-slate-100 text-slate-500 line-through',
};

export function Badge({ value, kind = 'status' }: { value: string; kind?: 'status' | 'severity' }) {
  const style =
    kind === 'severity'
      ? (SEVERITY_STYLE[value] ?? 'bg-slate-100 text-slate-700')
      : (STATUS_STYLE[value] ?? 'bg-slate-100 text-slate-700');
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {value.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

export function Overdue({ days }: { days: number }) {
  return (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
      {days} day{days === 1 ? '' : 's'} overdue
    </span>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  // Empty states say what to do next — "no data" is a dead end.
  return (
    <div className="card p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{body}</p>
      {action && <Link href={action.href} className="btn-primary mt-4">{action.label}</Link>}
    </div>
  );
}

export function Section({ title, children, right }: {
  title: string; children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

export const HIERARCHY_LABEL: Record<string, string> = {
  ELIMINATION: 'Elimination',
  SUBSTITUTION: 'Substitution',
  ENGINEERING: 'Engineering control',
  ADMINISTRATIVE: 'Administrative',
  PPE: 'PPE',
};

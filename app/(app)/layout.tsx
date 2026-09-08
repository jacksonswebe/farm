import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCtx } from '@/server/auth/current';
import { readSession } from '@/server/auth/session';
import { hasPermission } from '@/server/auth/permissions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx('layout');
  const session = await readSession();
  if (!ctx || !session) redirect('/sign-in');

  // Nav is role-aware: a link the caller cannot use is not rendered. The
  // API enforces this independently — the UI only avoids dead ends.
  const nav = [
    { href: '/dashboard', label: 'Dashboard', show: hasPermission(ctx.role, 'dashboard.view') },
    { href: '/reports', label: 'Events', show: hasPermission(ctx.role, 'incident.view') },
    { href: '/reports/new', label: 'Report', show: hasPermission(ctx.role, 'incident.create') },
  ].filter((i) => i.show);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <Link href="/dashboard" className="font-bold text-brand">SafeSphere</Link>
          <nav className="flex flex-1 gap-1 text-sm">
            {nav.map((i) => (
              <Link key={i.href} href={i.href}
                className="rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100">
                {i.label}
              </Link>
            ))}
          </nav>
          <span className="hidden text-sm text-slate-500 sm:inline">
            {session.fullName} · {ctx.role.replace('_', ' ').toLowerCase()}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}

import { NextResponse } from 'next/server';
import { unsafeGlobalQuery } from '@/server/db/tenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Liveness + dependency check. The deploy pipeline gates on this, so it must
 * fail when the app cannot actually serve traffic — a 200 that only proves
 * the process started is worse than no health check.
 */
export async function GET() {
  const started = Date.now();
  const checks: Record<string, { ok: boolean; ms?: number; error?: string }> = {};

  try {
    const t = Date.now();
    await unsafeGlobalQuery().$queryRaw`SELECT 1`;
    checks.database = { ok: true, ms: Date.now() - t };
  } catch (err) {
    checks.database = { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }

  // Confirms RLS is armed: app.current_org() must be NULL with no context.
  try {
    const rows = await unsafeGlobalQuery().$queryRaw<
      { org: string | null }[]
    >`SELECT app.current_org()::text AS org`;
    checks.tenancy = { ok: rows[0]?.org === null };
  } catch (err) {
    checks.tenancy = { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }

  const healthy = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'dev',
      uptimeMs: Date.now() - started,
      checks,
    },
    { status: healthy ? 200 : 503 },
  );
}

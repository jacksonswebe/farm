import { NextResponse, type NextRequest } from 'next/server';
import { runJob } from '@/server/jobs';
import { JOBS, type JobName } from '@/server/jobs/types';
import { logger } from '@/server/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // Vercel Pro ceiling for a scheduled function

/**
 * The scheduler entry point. Vercel Cron calls this per the schedule in
 * vercel.json; the handlers themselves know nothing about HTTP, so the same
 * code runs unchanged under a pg-boss worker if we move off Vercel.
 *
 * Every handler is idempotent, which is what makes an at-least-once HTTP
 * trigger safe: a retried tick re-sends nothing.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  // Vercel signs cron invocations with CRON_SECRET as a bearer token.
  // Without this check the endpoint is a public denial-of-service handle.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  }

  const { job } = await params;
  if (!JOBS.includes(job as JobName)) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: `Unknown job: ${job}` } },
      { status: 404 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await runJob(job as JobName);
    logger.info({ ...result, durationMs: Date.now() - startedAt }, 'cron job completed');
    return NextResponse.json({ data: { ...result, durationMs: Date.now() - startedAt } });
  } catch (err) {
    logger.error({ err, job }, 'cron job failed');
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: `Job ${job} failed.` } },
      { status: 500 },
    );
  }
}

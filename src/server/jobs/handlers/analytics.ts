import { unsafeGlobalQuery } from '@/server/db/tenant';
import type { JobResult } from '../types';

/**
 * Trend tiles read materialized views; current-state tiles read the base
 * tables live. CONCURRENTLY needs the unique indexes defined in
 * db/schema.sql and avoids locking readers during the refresh.
 */
export async function refreshAnalytics(): Promise<JobResult> {
  const db = unsafeGlobalQuery();
  await db.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_incident_daily');
  await db.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_action_daily');
  return { job: 'analytics.refresh', processed: 2, skipped: 0, errors: 0 };
}

/** Presigned uploads that were never completed leave orphaned rows. */
export async function cleanupAttachments(now: Date): Promise<JobResult> {
  const db = unsafeGlobalQuery();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { count } = await db.attachments.deleteMany({
    where: { upload_status: 'PENDING', created_at: { lt: cutoff } },
  });
  return { job: 'attachments.cleanup', processed: count, skipped: 0, errors: 0 };
}

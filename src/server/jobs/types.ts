/**
 * Jobs are plain functions with no transport in them.
 *
 * They run today from Vercel Cron (an HTTP tick) and can run tomorrow from a
 * pg-boss worker on a VPS with no change to the handler. The scheduler is a
 * deployment detail; the work is not. See docs/08-DEPLOYMENT.md.
 */
export interface JobResult {
  job: string;
  processed: number;
  skipped: number;
  errors: number;
  detail?: Record<string, unknown>;
}

export type JobHandler = (now: Date) => Promise<JobResult>;

export const JOBS = [
  'reminders.actions',
  'escalations.actions',
  'reminders.investigations',
  'digest.weekly',
  'analytics.refresh',
  'attachments.cleanup',
  'trial.check',
] as const;

export type JobName = (typeof JOBS)[number];

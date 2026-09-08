import { refreshAnalytics, cleanupAttachments } from './handlers/analytics';
import { escalateOverdueActions, remindActionsDue } from './handlers/reminders';
import type { JobHandler, JobName } from './types';

/**
 * The job registry. The scheduler that calls these is a deployment detail:
 * Vercel Cron hits /api/cron/[job] today; a pg-boss worker calls the same
 * map on a VPS. Adding a scheduler never means rewriting a handler.
 */
export const JOB_HANDLERS: Record<JobName, JobHandler> = {
  'reminders.actions': remindActionsDue,
  'escalations.actions': escalateOverdueActions,
  'reminders.investigations': async () => ({
    job: 'reminders.investigations',
    processed: 0,
    skipped: 0,
    errors: 0,
    detail: { note: 'Implemented in Sprint 3 alongside the investigation workflow.' },
  }),
  'digest.weekly': async () => ({
    job: 'digest.weekly',
    processed: 0,
    skipped: 0,
    errors: 0,
    detail: { note: 'Implemented in Sprint 3 with the email templates.' },
  }),
  'analytics.refresh': refreshAnalytics,
  'attachments.cleanup': cleanupAttachments,
  'trial.check': async () => ({
    job: 'trial.check',
    processed: 0,
    skipped: 0,
    errors: 0,
    detail: { note: 'Implemented in Sprint 5 with billing.' },
  }),
};

export async function runJob(name: JobName, now = new Date()) {
  const handler = JOB_HANDLERS[name];
  if (!handler) throw new Error(`Unknown job: ${name}`);
  return handler(now);
}

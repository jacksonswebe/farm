import type { incidents, report_status } from '@prisma/client';
import type { Ctx } from '@/server/auth/context';
import { inSiteScope, requirePermission } from '@/server/auth/context';
import { AppError, ErrorCode, denied, invalidState } from '@/server/lib/errors';

/** The author's own-edit window after submission. */
const AUTHOR_EDIT_WINDOW_MS = 30 * 60 * 1000;

type IncidentRecord = Pick<
  incidents,
  'id' | 'status' | 'site_id' | 'reported_by_user_id' | 'reported_at' | 'severity' | 'lost_time'
>;

export const incidentPolicy = {
  canView(ctx: Ctx, incident: IncidentRecord): boolean {
    requirePermission(ctx, 'incident.view');
    // EMPLOYEE and ACTION_OWNER see only their own submissions.
    if (ctx.role === 'EMPLOYEE' || ctx.role === 'ACTION_OWNER') {
      return incident.reported_by_user_id === ctx.userId;
    }
    if (ctx.role === 'EXECUTIVE' || ctx.role === 'AUDITOR') return true;
    return inSiteScope(ctx, incident.site_id);
  },

  assertCanView(ctx: Ctx, incident: IncidentRecord): void {
    // A record the caller may not see is reported as absent, never as
    // forbidden — a 403 confirms the record exists. docs/04-API-SPEC.md §1.
    if (!this.canView(ctx, incident)) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Record not found.');
    }
  },

  assertCanEdit(ctx: Ctx, incident: IncidentRecord): void {
    this.assertCanView(ctx, incident);
    requirePermission(ctx, 'incident.edit');

    if (incident.status === 'CLOSED') {
      throw invalidState('A closed event is read-only.');
    }

    const isAuthor = incident.reported_by_user_id === ctx.userId;
    const isHse = ctx.role === 'HSE_MANAGER' || ctx.role === 'SITE_MANAGER';

    if (!isHse) {
      if (!isAuthor) throw denied('Only the author or an HSE role may edit this event.');
      if (incident.status !== 'DRAFT') {
        const age = Date.now() - incident.reported_at.getTime();
        if (age > AUTHOR_EDIT_WINDOW_MS) {
          throw denied(
            'The 30-minute edit window has passed. Ask an HSE manager to make the change.',
          );
        }
      }
    }
  },

  assertCanClassify(ctx: Ctx, incident: IncidentRecord): void {
    this.assertCanView(ctx, incident);
    requirePermission(ctx, 'incident.classify');
    const classifiable: report_status[] = ['SUBMITTED', 'ACKNOWLEDGED', 'INVESTIGATING'];
    if (!classifiable.includes(incident.status)) {
      throw invalidState(`An event with status ${incident.status} cannot be reclassified.`);
    }
  },

  assertCanClose(ctx: Ctx, incident: IncidentRecord, openActionCount: number): void {
    this.assertCanView(ctx, incident);
    requirePermission(ctx, 'incident.close');
    if (incident.status === 'CLOSED') throw invalidState('This event is already closed.');
    if (openActionCount > 0) {
      throw new AppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `${openActionCount} action(s) are still open. Every action must be verified or cancelled before closing.`,
      );
    }
  },

  /**
   * Injury and health detail is decided per person, not per incident.
   *
   * Reporting an incident does not entitle you to the injured person's
   * medical detail. A witness who files the report is exactly the case that
   * makes an incident-level rule wrong: they would receive a colleague's
   * diagnosis, body part and lost days simply for doing the right thing.
   *
   * So: HSE and the assigned investigator see it because they must
   * investigate; everyone else sees it only on the record about themselves.
   */
  canViewPersonSensitive(ctx: Ctx, person: { user_id: string | null }): boolean {
    if (ctx.role === 'HSE_MANAGER' || ctx.role === 'INVESTIGATOR') return true;
    return person.user_id !== null && person.user_id === ctx.userId;
  },

  /** True when the caller may see health data for anyone on the record. */
  canViewSensitive(ctx: Ctx): boolean {
    return ctx.role === 'HSE_MANAGER' || ctx.role === 'INVESTIGATOR';
  },
};

/**
 * Severity >= MAJOR or a lost-time injury forces an investigation. This is
 * a safety rule, not a preference: it is applied server-side regardless of
 * what the client sends.
 */
export function investigationIsMandatory(
  severity: string | null,
  lostTime: boolean,
): boolean {
  return severity === 'MAJOR' || severity === 'CATASTROPHIC' || lostTime;
}

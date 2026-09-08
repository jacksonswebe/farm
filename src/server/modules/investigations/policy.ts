import type { investigation_status, investigations, severity_level } from '@prisma/client';
import type { Ctx } from '@/server/auth/context';
import { requirePermission } from '@/server/auth/context';
import { AppError, ErrorCode, denied, invalidState } from '@/server/lib/errors';

type InvestigationRecord = Pick<
  investigations,
  'id' | 'status' | 'lead_investigator_id' | 'team_user_ids'
>;

const EDITABLE: investigation_status[] = ['ASSIGNED', 'IN_PROGRESS', 'RETURNED'];

/**
 * Investigation due dates scale with severity. A catastrophic event
 * investigated on the same 7-day clock as a minor one is a process that
 * exists on paper only.
 */
const DUE_DAYS_BY_SEVERITY: Record<severity_level, number> = {
  CATASTROPHIC: 2,
  MAJOR: 5,
  MODERATE: 7,
  MINOR: 14,
  NEGLIGIBLE: 14,
};

export function defaultInvestigationDueAt(severity: severity_level | null, from = new Date()): Date {
  const days = severity ? DUE_DAYS_BY_SEVERITY[severity] : 7;
  const due = new Date(from);
  due.setUTCDate(due.getUTCDate() + days);
  return due;
}

export const investigationPolicy = {
  isOnTeam(ctx: Ctx, inv: InvestigationRecord): boolean {
    return inv.lead_investigator_id === ctx.userId || inv.team_user_ids.includes(ctx.userId);
  },

  assertCanView(ctx: Ctx, inv: InvestigationRecord): void {
    requirePermission(ctx, 'investigation.view');
    if (ctx.role === 'INVESTIGATOR' && !this.isOnTeam(ctx, inv)) {
      // Not "forbidden" — an investigator should not learn which
      // investigations exist that they are not on.
      throw new AppError(ErrorCode.NOT_FOUND, 'Investigation not found.');
    }
  },

  assertCanEdit(ctx: Ctx, inv: InvestigationRecord): void {
    this.assertCanView(ctx, inv);
    requirePermission(ctx, 'investigation.conduct');
    if (ctx.role === 'INVESTIGATOR' && !this.isOnTeam(ctx, inv)) {
      throw denied('You are not assigned to this investigation.');
    }
    if (!EDITABLE.includes(inv.status)) {
      throw invalidState(
        inv.status === 'APPROVED'
          ? 'An approved investigation is a closed record and cannot be edited.'
          : `An investigation with status ${inv.status} cannot be edited.`,
      );
    }
  },

  assertCanSubmit(
    ctx: Ctx,
    inv: InvestigationRecord,
    counts: { findings: number; rootCauses: number; actions: number },
  ): void {
    this.assertCanEdit(ctx, inv);

    // These three guards are the difference between an investigation and a
    // form. An investigation with no cause and no action changes nothing.
    const missing: string[] = [];
    if (counts.findings === 0) missing.push('at least one finding');
    if (counts.rootCauses === 0) missing.push('at least one root cause');
    if (counts.actions === 0) missing.push('at least one corrective or preventive action');
    if (missing.length > 0) {
      throw new AppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        `This investigation needs ${missing.join(', ')} before it can be submitted.`,
      );
    }
  },

  assertCanDecide(ctx: Ctx, inv: InvestigationRecord): void {
    requirePermission(ctx, 'investigation.approve');
    if (inv.status !== 'SUBMITTED') {
      throw invalidState('Only a submitted investigation can be approved or returned.');
    }
    // The investigator who did the work cannot approve their own conclusions.
    if (inv.lead_investigator_id === ctx.userId) {
      throw denied('An investigation must be approved by someone other than its lead.');
    }
  },
};

/**
 * Flags a root cause that names a person rather than a system condition.
 *
 * Advisory, never blocking — a guardrail, not a gate. "Operator error" as a
 * root cause ends the enquiry exactly where it should begin, and the point of
 * the 5 Whys is to get past it.
 */
const BLAME_PATTERNS = [
  /\b(operator|human|worker|employee|staff|driver|technician)\s+(error|mistake|fault|negligence)\b/i,
  /\b(careless|complacen\w*|lazy|incompeten\w*|reckless)\b/i,
  /\bfailed to (follow|comply|obey|adhere)\b/i,
  /\b(did ?n[o']t|didn't) (pay attention|concentrate|think|care)\b/i,
];

export function detectBlame(statement: string): string | null {
  for (const re of BLAME_PATTERNS) {
    if (re.test(statement)) {
      return 'This root cause describes a person rather than a system condition. Ask one more "why": what allowed this to happen, and what would have stopped it?';
    }
  }
  return null;
}

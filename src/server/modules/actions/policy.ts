import type { actions, action_status, severity_level } from '@prisma/client';
import type { Ctx } from '@/server/auth/context';
import { inSiteScope, requirePermission } from '@/server/auth/context';
import { AppError, ErrorCode, denied, invalidState } from '@/server/lib/errors';

type ActionRecord = Pick<
  actions,
  'id' | 'status' | 'owner_user_id' | 'verifier_user_id' | 'site_id' | 'due_date'
>;

const OPEN: action_status[] = ['OPEN', 'IN_PROGRESS', 'REJECTED'];

export function isOverdue(action: Pick<actions, 'status' | 'due_date'>, now = new Date()): boolean {
  // Derived, never stored — a stored flag needs a nightly sweep and drifts
  // between sweeps, which is exactly when someone looks at it.
  if (!OPEN.includes(action.status)) return false;
  return action.due_date.getTime() < new Date(now.toISOString().slice(0, 10)).getTime();
}

/**
 * Evidence is mandatory above minor severity. "Done" without evidence is a
 * claim; the whole point of verification is that someone can check it.
 */
export function evidenceRequiredFor(severity: severity_level | null): boolean {
  return severity === 'MODERATE' || severity === 'MAJOR' || severity === 'CATASTROPHIC';
}

export const actionPolicy = {
  canView(ctx: Ctx, action: ActionRecord): boolean {
    requirePermission(ctx, 'action.view');
    if (ctx.role === 'EMPLOYEE' || ctx.role === 'ACTION_OWNER') {
      return action.owner_user_id === ctx.userId || action.verifier_user_id === ctx.userId;
    }
    if (ctx.role === 'EXECUTIVE' || ctx.role === 'AUDITOR' || ctx.role === 'ORG_ADMIN') return true;
    if (ctx.role === 'HSE_MANAGER') return true;
    return inSiteScope(ctx, action.site_id) || action.owner_user_id === ctx.userId;
  },

  assertCanView(ctx: Ctx, action: ActionRecord): void {
    if (!this.canView(ctx, action)) throw new AppError(ErrorCode.NOT_FOUND, 'Action not found.');
  },

  assertCanUpdateProgress(ctx: Ctx, action: ActionRecord): void {
    this.assertCanView(ctx, action);
    requirePermission(ctx, 'action.update_progress');
    if (!OPEN.includes(action.status)) {
      throw invalidState(`An action with status ${action.status} can no longer be worked on.`);
    }
    const isOwner = action.owner_user_id === ctx.userId;
    const isManager = ctx.role === 'HSE_MANAGER' || ctx.role === 'SITE_MANAGER';
    if (!isOwner && !isManager) throw denied('Only the owner may update this action.');
  },

  assertCanSubmit(ctx: Ctx, action: ActionRecord, evidenceCount: number, required: boolean): void {
    this.assertCanUpdateProgress(ctx, action);
    requirePermission(ctx, 'action.submit_for_verification');
    if (required && evidenceCount === 0) {
      throw new AppError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'This action came from a moderate or higher severity event, so completion evidence is required.',
      );
    }
  },

  /**
   * The owner may never verify their own action. Enforced here, and again by
   * the actions_owner_is_not_verifier check constraint in the database — a
   * self-verified corrective action is the single most common way a CAPA
   * process becomes theatre.
   */
  assertCanVerify(ctx: Ctx, action: ActionRecord): void {
    this.assertCanView(ctx, action);
    requirePermission(ctx, 'action.verify');
    if (action.status !== 'PENDING_VERIFICATION') {
      throw invalidState('Only an action submitted for verification can be verified.');
    }
    if (action.owner_user_id === ctx.userId) {
      throw new AppError(
        ErrorCode.OWNER_CANNOT_VERIFY,
        'An action cannot be verified by its own owner.',
      );
    }
    if (action.verifier_user_id && action.verifier_user_id !== ctx.userId) {
      const isManager = ctx.role === 'HSE_MANAGER';
      if (!isManager) throw denied('This action is assigned to a different verifier.');
    }
  },

  assertCanDecideExtension(ctx: Ctx, action: ActionRecord): void {
    this.assertCanView(ctx, action);
    requirePermission(ctx, 'action.approve_extension');
    if (action.owner_user_id === ctx.userId) {
      throw denied('You cannot approve your own extension request.');
    }
  },

  assertCanCancel(ctx: Ctx, action: ActionRecord): void {
    this.assertCanView(ctx, action);
    requirePermission(ctx, 'action.cancel');
    if (action.status === 'VERIFIED_CLOSED') {
      throw invalidState('A verified action cannot be cancelled.');
    }
  },
};

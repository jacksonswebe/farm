import type { org_role } from '@prisma/client';
import { AppError, ErrorCode, denied } from '@/server/lib/errors';
import { hasPermission, type Permission } from './permissions';

/**
 * The caller. Every service function takes this as its first argument, so
 * authorization is never implicit and never read from ambient state.
 */
export interface Ctx {
  userId: string;
  orgId: string;
  role: org_role;
  allSites: boolean;
  siteIds: readonly string[];
  requestId: string;
}

export function requirePermission(ctx: Ctx, permission: Permission): void {
  if (!hasPermission(ctx.role, permission)) {
    throw denied(`Your role (${ctx.role}) cannot ${permission}.`);
  }
}

/**
 * A user with allSites=false and an empty scope sees nothing. That is
 * intentional: a half-configured user must not silently see the whole
 * organization. See docs/05-RBAC-MATRIX.md section 4.
 */
export function inSiteScope(ctx: Ctx, siteId: string | null | undefined): boolean {
  if (ctx.allSites) return true;
  if (!siteId) return false;
  return ctx.siteIds.includes(siteId);
}

export function requireSiteScope(ctx: Ctx, siteId: string | null | undefined): void {
  if (!inSiteScope(ctx, siteId)) {
    throw new AppError(ErrorCode.OUT_OF_SCOPE, 'That record is outside your assigned sites.');
  }
}

/** Prisma `where` fragment applying the caller's site scope. */
export function siteScopeFilter(ctx: Ctx): { site_id?: { in: string[] } } {
  return ctx.allSites ? {} : { site_id: { in: [...ctx.siteIds] } };
}

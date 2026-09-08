import type { Ctx } from '@/server/auth/context';
import { requirePermission } from '@/server/auth/context';
import { withTenant, type TenantTx } from '@/server/db/tenant';

/**
 * The dashboard from docs/01-PRD-MVP.md §12.
 *
 * Two different freshness contracts, deliberately:
 *   - "current state" tiles (open, overdue, awaiting verification) read the
 *     base tables live. An operational number that is 29 minutes stale is
 *     worse than no number, because someone will act on it.
 *   - trend tiles read materialized views refreshed every 30 minutes, because
 *     a 12-month trend does not change meaningfully within half an hour.
 */

export interface DashboardSummary {
  eventsThisPeriod: { total: number; previous: number; byType: Record<string, number> };
  openByStatus: Record<string, number>;
  overdueActions: number;
  actionsDueNext7Days: number;
  overdueInvestigations: number;
  awaitingVerification: number;
  severityMix: Record<string, number>;
  leadingLaggingRatio: number | null;
  medianHoursToReport: number | null;
  medianHoursToAcknowledge: number | null;
  medianDaysToInvestigate: number | null;
  medianDaysToClose: number | null;
  actionClosureRate: number | null;
  overdueRate: number | null;
  hierarchyMix: Record<string, number>;
  topRootCauses: { category: string; count: number }[];
  bySite: { site: string; total: number; open: number }[];
  participation: { reporters: number; activeUsers: number } | null;
}

/**
 * Site scope as a SQL fragment. Prisma cannot express these aggregate queries
 * without several round trips, so they are hand-written — but the scope filter
 * still has to be applied, and RLS still bounds everything to the tenant.
 */
function scopeClause(ctx: Ctx): { sql: string; params: unknown[] } {
  if (ctx.allSites) return { sql: '', params: [] };
  if (ctx.siteIds.length === 0) return { sql: ' AND false', params: [] };
  return { sql: ` AND site_id = ANY($1::uuid[])`, params: [ctx.siteIds] };
}

async function raw<T>(tx: TenantTx, sql: string, params: unknown[]): Promise<T[]> {
  return tx.$queryRawUnsafe<T[]>(sql, ...params);
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export const analyticsService = {
  async summary(ctx: Ctx, days = 30): Promise<DashboardSummary> {
    requirePermission(ctx, 'dashboard.view');

    return withTenant(ctx.orgId, async (tx) => {
      const scope = scopeClause(ctx);
      const p = scope.params;
      const REAL = `status NOT IN ('DRAFT','REJECTED','DUPLICATE')`;

      const [
        periodRows, openRows, severityRows, timingRows, siteRows,
        actionRows, hierarchyRows, rootCauseRows, participationRows,
        overdueInv, awaitingVerification,
        investigationTiming,
      ] = await Promise.all([
        // Current period vs the one before it, by report type.
        raw<{ report_type: string; current: bigint; previous: bigint }>(tx, `
          SELECT report_type,
                 count(*) FILTER (WHERE occurred_at >= now() - ($${p.length + 1} || ' days')::interval) AS current,
                 count(*) FILTER (WHERE occurred_at <  now() - ($${p.length + 1} || ' days')::interval
                               AND occurred_at >= now() - (($${p.length + 1}::int * 2) || ' days')::interval) AS previous
          FROM incidents WHERE ${REAL}${scope.sql}
          GROUP BY 1`, [...p, days]),

        raw<{ status: string; n: bigint }>(tx, `
          SELECT status, count(*) AS n FROM incidents
          WHERE status IN ('SUBMITTED','ACKNOWLEDGED','INVESTIGATING','ACTIONS_PENDING','PENDING_CLOSURE')
          ${scope.sql} GROUP BY 1`, p),

        raw<{ severity: string; n: bigint }>(tx, `
          SELECT COALESCE(severity::text,'UNCLASSIFIED') AS severity, count(*) AS n
          FROM incidents WHERE ${REAL}
            AND occurred_at >= now() - ($${p.length + 1} || ' days')::interval
          ${scope.sql} GROUP BY 1`, [...p, days]),

        // Medians, not means: one incident reported six months late would
        // drag a mean into uselessness.
        raw<{ h_report: number | null; h_ack: number | null; d_close: number | null }>(tx, `
          SELECT
            percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (reported_at - occurred_at))/3600) AS h_report,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (acknowledged_at - reported_at))/3600)
              FILTER (WHERE acknowledged_at IS NOT NULL) AS h_ack,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (closed_at - reported_at))/86400)
              FILTER (WHERE closed_at IS NOT NULL) AS d_close
          FROM incidents WHERE ${REAL}${scope.sql}`, p),

        raw<{ site: string; total: bigint; open: bigint }>(tx, `
          SELECT s.name AS site, count(*) AS total,
                 count(*) FILTER (WHERE i.status IN
                   ('SUBMITTED','ACKNOWLEDGED','INVESTIGATING','ACTIONS_PENDING','PENDING_CLOSURE')) AS open
          FROM incidents i JOIN sites s ON s.id = i.site_id
          WHERE i.${REAL}${scope.sql.replace('site_id', 'i.site_id')}
          GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, p),

        raw<{ total: bigint; closed: bigint; on_time: bigint; overdue: bigint; due_7: bigint }>(tx, `
          SELECT count(*) AS total,
                 count(*) FILTER (WHERE status = 'VERIFIED_CLOSED') AS closed,
                 count(*) FILTER (WHERE status = 'VERIFIED_CLOSED' AND verified_at::date <= due_date) AS on_time,
                 count(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS','REJECTED') AND due_date < current_date) AS overdue,
                 count(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS')
                                    AND due_date BETWEEN current_date AND current_date + 7) AS due_7
          FROM actions WHERE true${scope.sql}`, p),

        // The tile that says whether the organisation is engineering risk out
        // or just issuing PPE.
        raw<{ hierarchy_level: string; n: bigint }>(tx, `
          SELECT hierarchy_level, count(*) AS n FROM (
            SELECT hierarchy_level FROM actions WHERE true${scope.sql}
            ORDER BY created_at DESC LIMIT 50
          ) t GROUP BY 1 ORDER BY 2 DESC`, p),

        raw<{ category: string; n: bigint }>(tx, `
          SELECT category::text AS category, count(*) AS n
          FROM root_causes GROUP BY 1 ORDER BY 2 DESC LIMIT 5`, []),

        raw<{ reporters: bigint; active: bigint }>(tx, `
          SELECT count(DISTINCT reported_by_user_id) AS reporters,
                 (SELECT count(*) FROM memberships WHERE is_active) AS active
          FROM incidents
          WHERE reported_at >= now() - ($${p.length + 1} || ' days')::interval
            AND reported_by_user_id IS NOT NULL${scope.sql}`, [...p, days]),

        tx.investigations.count({
          where: { status: { in: ['ASSIGNED', 'IN_PROGRESS', 'RETURNED'] }, due_at: { lt: new Date() } },
        }),

        tx.actions.count({ where: { status: 'PENDING_VERIFICATION' } }),

        // Investigation turnaround is assignment to approval — a different
        // measurement from event-to-closure, which also waits on every CAPA.
        raw<{ d_investigate: number | null }>(tx, `
          SELECT percentile_cont(0.5) WITHIN GROUP
                   (ORDER BY EXTRACT(EPOCH FROM (approved_at - assigned_at))/86400) AS d_investigate
          FROM investigations WHERE approved_at IS NOT NULL`, []),
      ]);

      const byType: Record<string, number> = {};
      let total = 0;
      let previous = 0;
      for (const row of periodRows) {
        byType[row.report_type] = num(row.current);
        total += num(row.current);
        previous += num(row.previous);
      }

      const leading = ['NEAR_MISS', 'HAZARD', 'OBSERVATION'].reduce(
        (sum, t) => sum + (byType[t] ?? 0), 0);
      const lagging = byType.INCIDENT ?? 0;

      const a = actionRows[0];
      const timing = timingRows[0];
      const part = participationRows[0];

      const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

      return {
        eventsThisPeriod: { total, previous, byType },
        openByStatus: Object.fromEntries(openRows.map((r) => [r.status, num(r.n)])),
        overdueActions: num(a?.overdue),
        actionsDueNext7Days: num(a?.due_7),
        overdueInvestigations: overdueInv,
        awaitingVerification,
        severityMix: Object.fromEntries(severityRows.map((r) => [r.severity, num(r.n)])),
        // Leading indicators divided by lagging. A ratio below ~5:1 usually
        // means near misses are going unreported, not that they are not happening.
        leadingLaggingRatio: lagging > 0 ? Math.round((leading / lagging) * 10) / 10 : null,
        medianHoursToReport: round1(numOrNull(timing?.h_report)),
        medianHoursToAcknowledge: round1(numOrNull(timing?.h_ack)),
        medianDaysToInvestigate: round1(numOrNull(investigationTiming[0]?.d_investigate)),
        medianDaysToClose: round1(numOrNull(timing?.d_close)),
        actionClosureRate:
          a && num(a.closed) > 0 ? Math.round((num(a.on_time) / num(a.closed)) * 1000) / 10 : null,
        overdueRate:
          a && num(a.total) > 0 ? Math.round((num(a.overdue) / num(a.total)) * 1000) / 10 : null,
        hierarchyMix: Object.fromEntries(hierarchyRows.map((r) => [r.hierarchy_level, num(r.n)])),
        topRootCauses: rootCauseRows.map((r) => ({ category: r.category, count: num(r.n) })),
        bySite: siteRows.map((r) => ({ site: r.site, total: num(r.total), open: num(r.open) })),
        participation: part ? { reporters: num(part.reporters), activeUsers: num(part.active) } : null,
      };
    });
  },

  /** Monthly trend from the materialized views. */
  async trends(ctx: Ctx, months = 12) {
    requirePermission(ctx, 'dashboard.view');
    return withTenant(ctx.orgId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        { month: Date; events: bigint; lost_time: bigint; closed: bigint }[]
      >(`
        SELECT date_trunc('month', day)::date AS month,
               sum(event_count)     AS events,
               sum(lost_time_count) AS lost_time,
               sum(closed_count)    AS closed
        FROM mv_incident_daily
        WHERE day >= (current_date - ($1 || ' months')::interval)
        GROUP BY 1 ORDER BY 1`, String(months));

      return rows.map((r) => ({
        month: r.month,
        events: num(r.events),
        lostTime: num(r.lost_time),
        closed: num(r.closed),
      }));
    });
  },
};

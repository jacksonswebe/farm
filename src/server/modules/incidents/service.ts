import type { Prisma, report_status, report_type, severity_level } from '@prisma/client';
import type { Ctx } from '@/server/auth/context';
import { requirePermission, siteScopeFilter } from '@/server/auth/context';
import { withTenant, type TenantTx } from '@/server/db/tenant';
import { notFound } from '@/server/lib/errors';
import { recordAudit } from '@/server/modules/audit/service';
import { incidentPolicy, investigationIsMandatory } from './policy';
import type {
  ClassifyIncidentInput,
  CreateIncidentInput,
  ListIncidentsInput,
} from './schema';

const OPEN_STATUSES: report_status[] = [
  'SUBMITTED',
  'ACKNOWLEDGED',
  'INVESTIGATING',
  'ACTIONS_PENDING',
  'PENDING_CLOSURE',
];

/** Gapless per-org, per-year reference. See db/schema.sql app.next_reference. */
async function nextReference(tx: TenantTx, orgId: string, prefix: string): Promise<string> {
  const rows = await tx.$queryRaw<{ next_reference: string }[]>`
    SELECT app.next_reference(${orgId}::uuid, ${prefix}::text) AS next_reference
  `;
  const ref = rows[0]?.next_reference;
  if (!ref) throw new Error('Reference generation returned no value.');
  return ref;
}

function splitCsv<T extends string>(value: string | undefined): T[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? (parts as T[]) : undefined;
}

/** Opaque keyset cursor: (created_at, id). Never OFFSET. */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ c: createdAt.toISOString(), i: id })).toString('base64url');
}
function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      c?: string;
      i?: string;
    };
    if (!raw.c || !raw.i) return null;
    return { createdAt: new Date(raw.c), id: raw.i };
  } catch {
    return null;
  }
}

export const incidentService = {
  async create(ctx: Ctx, input: CreateIncidentInput) {
    requirePermission(ctx, 'incident.create');

    return withTenant(ctx.orgId, async (tx) => {
      const site = await tx.sites.findFirst({
        where: { id: input.siteId, is_active: true },
        select: { id: true },
      });
      if (!site) throw notFound('Site');

      const reference = await nextReference(tx, ctx.orgId, 'INC');
      const status: report_status = input.asDraft ? 'DRAFT' : 'SUBMITTED';

      const incident = await tx.incidents.create({
        data: {
          organization_id: ctx.orgId,
          reference,
          report_type: input.reportType as report_type,
          status,
          source: 'WEB',
          title: input.title ?? null,
          description: input.description,
          immediate_action: input.immediateAction ?? null,
          site_id: input.siteId,
          department_id: input.departmentId ?? null,
          work_area: input.workArea ?? null,
          severity: (input.severity as severity_level | undefined) ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          occurred_at: input.occurredAt,
          reported_by_user_id: ctx.userId,
        },
      });

      // Attachments are uploaded before the record exists, so they are
      // re-pointed at it here rather than created with it.
      if (input.attachmentIds.length > 0) {
        await tx.attachments.updateMany({
          where: { id: { in: input.attachmentIds }, organization_id: ctx.orgId },
          data: { entity: 'INCIDENT', entity_id: incident.id },
        });
      }

      await recordAudit(tx, ctx, {
        action: 'CREATE',
        entity: 'INCIDENT',
        entityId: incident.id,
        entityReference: incident.reference,
        changes: { status: { from: null, to: status } },
      });

      return incident;
    });
  },

  async list(ctx: Ctx, input: ListIncidentsInput) {
    requirePermission(ctx, 'incident.view');

    return withTenant(ctx.orgId, async (tx) => {
      const cursor = input.cursor ? decodeCursor(input.cursor) : null;

      const where: Prisma.incidentsWhereInput = {
        ...siteScopeFilter(ctx),
        ...(input.site ? { site_id: input.site } : {}),
        ...(splitCsv<report_type>(input.type)
          ? { report_type: { in: splitCsv<report_type>(input.type) } }
          : {}),
        ...(splitCsv<report_status>(input.status)
          ? { status: { in: splitCsv<report_status>(input.status) } }
          : {}),
        ...(splitCsv<severity_level>(input.severity)
          ? { severity: { in: splitCsv<severity_level>(input.severity) } }
          : {}),
        ...(input.from || input.to
          ? { occurred_at: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
          : {}),
        // Employees and action owners see only what they reported.
        ...(ctx.role === 'EMPLOYEE' || ctx.role === 'ACTION_OWNER'
          ? { reported_by_user_id: ctx.userId }
          : {}),
        // Drafts are private to their author.
        ...(ctx.role === 'HSE_MANAGER'
          ? {}
          : { NOT: { AND: [{ status: 'DRAFT' }, { reported_by_user_id: { not: ctx.userId } }] } }),
        ...(cursor
          ? {
              OR: [
                { created_at: { lt: cursor.createdAt } },
                { created_at: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      };

      const rows = await tx.incidents.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: input.limit + 1, // one extra row tells us whether more exist
        select: {
          id: true,
          reference: true,
          report_type: true,
          status: true,
          title: true,
          description: true,
          severity: true,
          risk_band: true,
          occurred_at: true,
          reported_at: true,
          created_at: true,
          sites: { select: { id: true, name: true } },
        },
      });

      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;
      const last = page[page.length - 1];

      return {
        data: page.map((r) => ({
          id: r.id,
          reference: r.reference,
          reportType: r.report_type,
          status: r.status,
          title: r.title ?? r.description.slice(0, 120),
          severity: r.severity,
          riskBand: r.risk_band,
          siteName: r.sites.name,
          occurredAt: r.occurred_at,
          reportedAt: r.reported_at,
        })),
        meta: {
          nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
          hasMore,
        },
      };
    });
  },

  async getById(ctx: Ctx, id: string) {
    requirePermission(ctx, 'incident.view');

    return withTenant(ctx.orgId, async (tx) => {
      const incident = await tx.incidents.findUnique({
        where: { id },
        include: {
          sites: { select: { id: true, name: true, timezone: true } },
          departments: { select: { id: true, name: true } },
          users_incidents_reported_by_user_idTousers: {
            select: { id: true, full_name: true, email: true },
          },
          incident_persons: true,
        },
      });
      if (!incident) throw notFound('Event');
      incidentPolicy.assertCanView(ctx, incident);

      // Attachments are polymorphic on (entity, entity_id), so there is no
      // foreign key for Prisma to traverse — they are fetched by that pair.
      const attachments = await tx.attachments.findMany({
        where: {
          entity: 'INCIDENT',
          entity_id: incident.id,
          deleted_at: null,
          upload_status: 'UPLOADED',
        },
        select: {
          id: true, file_name: true, mime_type: true, size_bytes: true,
          caption: true, is_sensitive: true, created_at: true,
        },
        orderBy: { created_at: 'asc' },
      });

      // Health data is stripped here, not in the route, so a new endpoint
      // cannot accidentally expose it. docs/05-RBAC-MATRIX.md section 5.
      // The decision is per person: filing a report does not entitle the
      // reporter to a colleague's medical detail.
      const showSensitive = incidentPolicy.canViewSensitive(ctx);
      let redactedAny = false;
      const persons = incident.incident_persons.map((p) => {
        if (!p.is_sensitive || incidentPolicy.canViewPersonSensitive(ctx, p)) return p;
        redactedAny = true;
        return {
          ...p,
          injury_type_term_id: null,
          body_part_term_id: null,
          treatment: null,
          days_lost: null,
          statement: null,
        };
      });

      return {
        ...incident,
        incident_persons: persons,
        attachments: showSensitive ? attachments : attachments.filter((a) => !a.is_sensitive),
        sensitiveRedacted: redactedAny,
      };
    });
  },

  async classify(ctx: Ctx, id: string, input: ClassifyIncidentInput) {
    return withTenant(ctx.orgId, async (tx) => {
      const incident = await tx.incidents.findUnique({ where: { id } });
      if (!incident) throw notFound('Event');
      incidentPolicy.assertCanClassify(ctx, incident);

      // The client cannot opt out of an investigation for a serious event.
      const mandatory = investigationIsMandatory(input.severity, incident.lost_time);
      const investigationRequired = mandatory ? true : (input.investigationRequired ?? false);

      const updated = await tx.incidents.update({
        where: { id },
        data: {
          severity: input.severity,
          likelihood: input.likelihood,
          category_term_id: input.categoryTermId ?? incident.category_term_id,
          investigation_required: investigationRequired,
          reportable_to_authority:
            input.reportableToAuthority ?? incident.reportable_to_authority,
          status: incident.status === 'SUBMITTED' ? 'ACKNOWLEDGED' : incident.status,
          acknowledged_at: incident.acknowledged_at ?? new Date(),
          acknowledged_by_user_id: incident.acknowledged_by_user_id ?? ctx.userId,
        },
      });

      await recordAudit(tx, ctx, {
        action: 'UPDATE',
        entity: 'INCIDENT',
        entityId: id,
        entityReference: incident.reference,
        changes: {
          severity: { from: incident.severity, to: updated.severity },
          likelihood: { from: incident.likelihood, to: updated.likelihood },
          investigation_required: {
            from: incident.investigation_required,
            to: updated.investigation_required,
          },
        },
      });

      // risk_score and risk_band are set by a database trigger, so they are
      // read back rather than computed here — one source of truth.
      return updated;
    });
  },

  async close(ctx: Ctx, id: string, closureStatement: string, lessonsLearned?: string) {
    return withTenant(ctx.orgId, async (tx) => {
      const incident = await tx.incidents.findUnique({ where: { id } });
      if (!incident) throw notFound('Event');

      const openActions = await tx.actions.count({
        where: {
          incident_id: id,
          status: { notIn: ['VERIFIED_CLOSED', 'CANCELLED'] },
        },
      });
      incidentPolicy.assertCanClose(ctx, incident, openActions);

      const updated = await tx.incidents.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closed_at: new Date(),
          closed_by_user_id: ctx.userId,
          closure_statement: closureStatement,
          lessons_learned: lessonsLearned ?? null,
        },
      });

      await recordAudit(tx, ctx, {
        action: 'STATUS_CHANGE',
        entity: 'INCIDENT',
        entityId: id,
        entityReference: incident.reference,
        changes: { status: { from: incident.status, to: 'CLOSED' } },
      });

      return updated;
    });
  },

  /** Current-state dashboard counters. Live SQL — never served stale. */
  async dashboardSummary(ctx: Ctx) {
    requirePermission(ctx, 'dashboard.view');

    return withTenant(ctx.orgId, async (tx) => {
      const scope = siteScopeFilter(ctx);
      const [total, open, overdueActions, dueSoon] = await Promise.all([
        tx.incidents.count({ where: { ...scope, status: { notIn: ['DRAFT', 'REJECTED', 'DUPLICATE'] } } }),
        tx.incidents.count({ where: { ...scope, status: { in: OPEN_STATUSES } } }),
        tx.actions.count({
          where: {
            status: { in: ['OPEN', 'IN_PROGRESS', 'REJECTED'] },
            due_date: { lt: new Date() },
          },
        }),
        tx.actions.count({
          where: {
            status: { in: ['OPEN', 'IN_PROGRESS'] },
            due_date: {
              gte: new Date(),
              lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          },
        }),
      ]);

      return { totalEvents: total, openEvents: open, overdueActions, actionsDueNext7Days: dueSoon };
    });
  },
};

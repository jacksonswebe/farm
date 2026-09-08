import { createCipheriv, randomBytes } from 'node:crypto';
import { unsafeGlobalQuery, withTenant } from '@/server/db/tenant';
import { AppError, ErrorCode, notFound } from '@/server/lib/errors';
import { enforceRateLimit } from '@/server/lib/ratelimit';
import type { AnonymousReportInput } from './schema';

/**
 * An optional contact left by an anonymous reporter is the most sensitive
 * field in the product: it is the thing that de-anonymises them. Stored
 * encrypted with a key the database never sees, so a database dump alone
 * cannot identify who reported what.
 */
function encryptContact(plain: string): Uint8Array<ArrayBuffer> {
  const keyHex = process.env.FIELD_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length < 64) {
    throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes of hex to store a reporter contact.');
  }
  const key = Buffer.from(keyHex.slice(0, 64), 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  // iv || authTag || ciphertext, as a plain Uint8Array for Prisma's Bytes.
  return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), enc]));
}

/**
 * Resolves a public site token to its organization. Runs outside any tenant
 * context by necessity — the token is what identifies the tenant — so it
 * reads only the two columns needed and nothing else.
 */
interface SiteTokenRow {
  site_id: string;
  organization_id: string;
  site_name: string;
  org_name: string;
  org_slug: string;
}

async function resolveSiteToken(token: string): Promise<SiteTokenRow | null> {
  // `sites` is RLS-protected and no tenant context exists yet — the token is
  // what establishes it. Reading the table directly returns zero rows.
  const rows = await unsafeGlobalQuery().$queryRaw<SiteTokenRow[]>`
    SELECT site_id::text, organization_id::text, site_name, org_name, org_slug
    FROM app.resolve_site_token(${token})
  `;
  return rows[0] ?? null;
}

export const anonymousReportService = {
  async submit(input: AnonymousReportInput, ip: string) {
    // Rate limited before the token lookup, so an invalid-token probe is
    // throttled too rather than being a free oracle.
    await enforceRateLimit(
      { key: `anon-report:ip:${ip}`, limit: 10, windowSeconds: 3600 },
      'Too many reports from this device in the last hour.',
    );

    const site = await resolveSiteToken(input.siteToken);
    if (!site) throw notFound('Reporting link');

    return withTenant(site.organization_id, async (tx) => {
      const refRows = await tx.$queryRaw<{ r: string }[]>`
        SELECT app.next_reference(${site.organization_id}::uuid, 'INC') AS r`;
      const reference = refRows[0]?.r;
      if (!reference) throw new AppError(ErrorCode.INTERNAL_ERROR, 'Could not allocate a reference.');

      const incident = await tx.incidents.create({
        data: {
          organization_id: site.organization_id,
          reference,
          report_type: input.reportType,
          status: 'SUBMITTED',
          source: 'ANONYMOUS_LINK',
          description: input.description,
          site_id: site.site_id,
          work_area: input.workArea ?? null,
          severity: input.severity ?? null,
          occurred_at: input.occurredAt,
          is_anonymous: true,
          reported_by_user_id: null,
          anonymous_contact_encrypted: input.contact ? encryptContact(input.contact) : null,
        },
      });

      // The HSE team still needs to know. No audit actor is recorded because
      // there is, by design, no actor to record.
      const hse = await tx.memberships.findMany({
        where: { role: 'HSE_MANAGER', is_active: true },
        select: { user_id: true },
      });
      if (hse.length > 0) {
        await tx.notifications.createMany({
          data: hse.map((m) => ({
            organization_id: site.organization_id,
            recipient_user_id: m.user_id,
            category: 'REPORT_SUBMITTED' as const,
            title: `Anonymous report: ${reference}`,
            body: input.description.slice(0, 200),
            entity: 'INCIDENT' as const,
            entity_id: incident.id,
            deep_link: `/reports/${incident.id}`,
          })),
        });
      }

      return { reference };
    });
  },

  /** Confirms a public link is live, so the page can 404 rather than render a dead form. */
  async describeLink(orgSlug: string, token: string) {
    const site = await resolveSiteToken(token);
    if (!site) return null;
    // The slug must match the token's own organization, so a valid token
    // cannot be replayed under another tenant's URL.
    if (site.org_slug.toLowerCase() !== orgSlug.toLowerCase()) return null;
    return { site_name: site.site_name, org_name: site.org_name };
  },
};

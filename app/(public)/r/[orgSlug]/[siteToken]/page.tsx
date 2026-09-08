import { notFound } from 'next/navigation';
import { anonymousReportService } from '@/server/modules/incidents/anonymous';
import AnonymousForm from './anonymous-form';

export const dynamic = 'force-dynamic';

/**
 * The public reporting page. No login, reachable from a QR code on a site
 * noticeboard. It exists because requiring an account before someone can
 * report a hazard suppresses exactly the leading-indicator data the whole
 * dashboard depends on.
 */
export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ orgSlug: string; siteToken: string }>;
}) {
  const { orgSlug, siteToken } = await params;
  const link = await anonymousReportService.describeLink(orgSlug, siteToken);
  if (!link) notFound();

  return (
    <main className="mx-auto min-h-dvh max-w-lg p-4">
      <div className="py-6">
        <p className="text-sm text-slate-500">{link.org_name}</p>
        <h1 className="text-2xl font-bold">Report a safety concern</h1>
        <p className="mt-1 text-sm text-slate-600">
          {link.site_name} · No name required, and no account needed.
        </p>
      </div>
      <AnonymousForm siteToken={siteToken} />
    </main>
  );
}

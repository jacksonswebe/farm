import { NextResponse, type NextRequest } from 'next/server';
import { LOCAL_STORAGE_ROOT } from '@/server/services/storage';
import { localDev } from '@/server/services/storage/local';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Development-only stand-in for S3, so the presign -> PUT -> complete flow can
 * be exercised end to end without cloud credentials. It refuses to run in
 * production, where the real presigned URLs point at the bucket instead.
 *
 * Access is HMAC-signed with the same scheme the local driver uses, so an
 * unsigned or expired request is rejected exactly as S3 would reject one.
 */
function guard(req: NextRequest, key: string, op: 'put' | 'get') {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  }
  const url = new URL(req.url);
  const ok = localDev.verify(
    key,
    op,
    Number(url.searchParams.get('expires')),
    url.searchParams.get('sig') ?? '',
    process.env.AUTH_SECRET ?? 'dev-storage-secret',
  );
  if (url.searchParams.get('op') !== op || !ok) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 403 });
  }
  return null;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join('/');
  const denied = guard(req, key, 'put');
  if (denied) return denied;

  const body = Buffer.from(await req.arrayBuffer());
  await localDev.write(
    LOCAL_STORAGE_ROOT,
    key,
    body,
    req.headers.get('content-type') ?? 'application/octet-stream',
  );
  return new NextResponse(null, { status: 200 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join('/');
  const denied = guard(req, key, 'get');
  if (denied) return denied;

  const file = await localDev.read(LOCAL_STORAGE_ROOT, key);
  if (!file) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      'content-type': file.contentType,
      // Never inline: an uploaded file must not execute in the app's origin.
      'content-disposition': 'attachment',
      'x-content-type-options': 'nosniff',
    },
  });
}

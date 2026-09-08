import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { unsafeGlobalQuery } from '@/server/db/tenant';

/**
 * Session handling on the auth_sessions table from db/schema.sql.
 *
 * Hand-rolled rather than Auth.js: our schema is snake_case and org-aware,
 * which would need a custom adapter anyway. This is ~80 lines we fully
 * control, and the session lives in the same database as everything else,
 * so revoking one is a DELETE rather than a distributed-state problem.
 */
export const SESSION_COOKIE = 'safesphere.sid';
const IDLE_HOURS = Number(process.env.SESSION_IDLE_TIMEOUT_HOURS ?? 12);

/** The cookie carries the raw token; only its hash is stored. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  userId: string,
  activeOrgId: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + IDLE_HOURS * 60 * 60 * 1000);

  await unsafeGlobalQuery().auth_sessions.create({
    data: {
      user_id: userId,
      session_token: hashToken(token),
      active_org_id: activeOrgId,
      ip_address: meta.ip ?? null,
      user_agent: meta.userAgent ?? null,
      expires_at: expiresAt,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return token;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await unsafeGlobalQuery()
      .auth_sessions.deleteMany({ where: { session_token: hashToken(token) } })
      .catch(() => undefined);
  }
  store.delete(SESSION_COOKIE);
}

export interface SessionUser {
  userId: string;
  orgId: string;
  fullName: string;
  email: string;
}

export async function readSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await unsafeGlobalQuery().auth_sessions.findUnique({
    where: { session_token: hashToken(token) },
    include: { users: { select: { id: true, full_name: true, email: true, deleted_at: true } } },
  });

  if (!session || !session.active_org_id) return null;
  if (session.expires_at.getTime() < Date.now()) return null;
  if (session.users.deleted_at) return null;

  return {
    userId: session.users.id,
    orgId: session.active_org_id,
    fullName: session.users.full_name,
    email: session.users.email,
  };
}

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { resolveMemberships } from '@/server/auth/memberships';
import { verifyPassword } from '@/server/auth/password';
import { createSession } from '@/server/auth/session';
import { unsafeGlobalQuery } from '@/server/db/tenant';
import { AppError, ErrorCode } from '@/server/lib/errors';
import { ok, requestId, toErrorResponse } from '@/server/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export async function POST(req: NextRequest) {
  const reqId = requestId();
  try {
    const { email, password } = loginSchema.parse(await req.json());
    const db = unsafeGlobalQuery();

    const user = await db.users.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deleted_at: null },
    });

    // One message for every failure mode. A distinct "no such account"
    // response is an account-enumeration oracle.
    const invalid = new AppError(ErrorCode.UNAUTHENTICATED, 'Incorrect email or password.');

    if (!user || !user.password_hash) throw invalid;
    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      throw new AppError(
        ErrorCode.RATE_LIMITED,
        'Too many failed attempts. Try again in a few minutes.',
      );
    }

    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) {
      const failed = user.failed_login_count + 1;
      await db.users.update({
        where: { id: user.id },
        data: {
          failed_login_count: failed,
          locked_until:
            failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
        },
      });
      throw invalid;
    }

    // memberships is RLS-protected and no tenant context exists yet, so this
    // goes through the SECURITY DEFINER resolver. See src/server/auth/memberships.ts.
    const memberships = await resolveMemberships(user.id);
    const membership = memberships[0];
    if (!membership) {
      throw new AppError(
        ErrorCode.ORG_CONTEXT_REQUIRED,
        'Your account is not attached to an active organization.',
      );
    }

    await db.users.update({
      where: { id: user.id },
      data: { failed_login_count: 0, locked_until: null, last_login_at: new Date() },
    });

    await createSession(user.id, membership.organizationId, {
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: req.headers.get('user-agent') ?? undefined,
    });

    return ok({ id: user.id, email: user.email, fullName: user.full_name });
  } catch (err) {
    return toErrorResponse(err, reqId);
  }
}

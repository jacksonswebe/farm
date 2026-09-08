import { unsafeGlobalQuery } from '@/server/db/tenant';
import { AppError, ErrorCode } from './errors';
import { logger } from './logger';

/**
 * Fixed-window rate limiting, backed by Postgres.
 *
 * Why not an in-process counter: on a serverless platform every request may
 * land on a fresh instance, so a module-level Map limits nothing. Why not
 * Redis: this needs no new vendor, and the volume — auth attempts and
 * anonymous reports — is trivial next to the request load the database
 * already carries.
 *
 * Fail-open by design. If the limiter itself errors, requests are allowed
 * through and the failure is logged: a limiter outage must not lock every
 * user out of a safety system.
 */
export interface RateLimitRule {
  key: string;
  limit: number;
  windowSeconds: number;
}

export async function enforceRateLimit(rule: RateLimitRule, message?: string): Promise<void> {
  const windowStart = new Date(
    Math.floor(Date.now() / (rule.windowSeconds * 1000)) * rule.windowSeconds * 1000,
  );

  let hits: number;
  try {
    const rows = await unsafeGlobalQuery().$queryRaw<{ hits: number }[]>`
      INSERT INTO rate_limits (bucket, window_start, hits)
      VALUES (${rule.key}, ${windowStart}, 1)
      ON CONFLICT (bucket, window_start)
      DO UPDATE SET hits = rate_limits.hits + 1
      RETURNING hits
    `;
    hits = rows[0]?.hits ?? 0;
  } catch (err) {
    logger.error({ err, bucket: rule.key }, 'rate limiter unavailable — allowing the request');
    return;
  }

  if (hits > rule.limit) {
    throw new AppError(
      ErrorCode.RATE_LIMITED,
      message ?? 'Too many requests. Wait a moment and try again.',
    );
  }
}

/** Best-effort client address. Trusted only as a rate-limit key, never for authorization. */
export function clientIp(req: { headers: Headers }): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

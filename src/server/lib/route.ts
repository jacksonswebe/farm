import { type NextRequest } from 'next/server';
import type { z } from 'zod';
import { requireCtx } from '@/server/auth/current';
import type { Ctx } from '@/server/auth/context';
import { ok, created, requestId, toErrorResponse } from './api';

/**
 * Removes the boilerplate every route otherwise repeats: make a request id,
 * resolve the caller, parse the body, and turn any thrown AppError into the
 * documented response shape. Route handlers stay three lines of intent.
 */
export function handler<S extends z.ZodTypeAny, R>(
  schema: S | null,
  fn: (ctx: Ctx, input: z.infer<S>, params: Record<string, string>) => Promise<R>,
  opts: { status?: 200 | 201 } = {},
) {
  // Next generates a route type where the second argument is required, so the
  // signature must match it exactly or `next build` rejects the route.
  return async (req: NextRequest, context: { params: Promise<Record<string, string>> }) => {
    const reqId = requestId();
    try {
      const ctx = await requireCtx(reqId);
      const params = (await context.params) ?? {};
      let input: unknown = undefined;
      if (schema) {
        const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
        input = schema.parse(body);
      }
      const result = await fn(ctx, input as z.infer<S>, params);
      return opts.status === 201 ? created(result) : ok(result);
    } catch (err) {
      return toErrorResponse(err, reqId);
    }
  };
}

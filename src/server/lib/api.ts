import { NextResponse } from 'next/server';
import { ZodError, type z } from 'zod';
import { AppError, ErrorCode } from './errors';
import { logger } from './logger';

export function requestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 });
}

export function paginated<T>(data: T[], meta: Record<string, unknown>) {
  return NextResponse.json({ data, meta });
}

/**
 * The single place an error becomes a response. Internal errors never leak
 * their message to the client — the requestId is the thread back to the log.
 */
export function toErrorResponse(err: unknown, reqId: string) {
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'The request did not pass validation.',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          requestId: reqId,
        },
      },
      { status: 400 },
    );
  }

  if (err instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
          requestId: reqId,
        },
      },
      { status: err.status },
    );
  }

  logger.error({ err, requestId: reqId }, 'Unhandled error in route handler');
  return NextResponse.json(
    {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Something went wrong. Quote the request id to support.',
        requestId: reqId,
      },
    },
    { status: 500 },
  );
}

/** Parses search params through a Zod schema, coercing repeated keys. */
export function parseQuery<S extends z.ZodTypeAny>(url: string, schema: S): z.infer<S> {
  const params = Object.fromEntries(new URL(url).searchParams.entries());
  return schema.parse(params) as z.infer<S>;
}

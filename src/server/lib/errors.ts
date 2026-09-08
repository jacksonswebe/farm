/** Error codes are the API contract — see docs/04-API-SPEC.md section 1. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
  ORG_CONTEXT_REQUIRED: 'ORG_CONTEXT_REQUIRED',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_STATE: 'INVALID_STATE',
  OWNER_CANNOT_VERIFY: 'OWNER_CANNOT_VERIFY',
  PLAN_LIMIT_EXCEEDED: 'PLAN_LIMIT_EXCEEDED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS: Record<ErrorCodeValue, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  OUT_OF_SCOPE: 403,
  ORG_CONTEXT_REQUIRED: 403,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  OWNER_CANNOT_VERIFY: 409,
  PLAN_LIMIT_EXCEEDED: 402,
  FILE_TOO_LARGE: 413,
  BUSINESS_RULE_VIOLATION: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;
  readonly details?: ErrorDetail[];

  constructor(code: ErrorCodeValue, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const notFound = (what = 'Record') => new AppError(ErrorCode.NOT_FOUND, `${what} not found.`);
export const denied = (message = 'You do not have permission to do that.') =>
  new AppError(ErrorCode.PERMISSION_DENIED, message);
export const invalidState = (message: string) => new AppError(ErrorCode.INVALID_STATE, message);
export const businessRule = (message: string) =>
  new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, message);

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  // Structured JSON in production so the log shipper can index org_id and
  // request_id; anything else is unsearchable at 3am.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      '*.password_hash',
      '*.token',
      '*.anonymous_contact_encrypted',
    ],
    censor: '[redacted]',
  },
});

export function requestLogger(requestId: string, orgId?: string, userId?: string) {
  return logger.child({ requestId, orgId, userId });
}

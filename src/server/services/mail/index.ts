import { logger } from '@/server/lib/logger';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailDriver {
  readonly name: string;
  send(message: MailMessage): Promise<{ id: string | null }>;
}

/**
 * Development driver. Logs the message rather than sending it, so the whole
 * notification path runs locally without an email provider and without any
 * risk of mailing a real person from a seeded demo tenant.
 */
function createConsoleDriver(): MailDriver {
  return {
    name: 'console',
    async send(message) {
      logger.info(
        { to: message.to, subject: message.subject, preview: message.text.slice(0, 160) },
        'email (console driver — not actually sent)',
      );
      return { id: null };
    },
  };
}

function createResendDriver(apiKey: string, from: string): MailDriver {
  return {
    name: 'resend',
    async send(message) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (!res.ok) {
        // Surfaced to the caller so the delivery row records a real failure
        // and the retry logic can decide, rather than failing silently.
        throw new Error(`Resend rejected the message: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { id?: string };
      return { id: body.id ?? null };
    },
  };
}

let cached: MailDriver | null = null;

export function createMailer(): MailDriver {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM ?? 'SafeSphere EHS <no-reply@example.invalid>';
  cached = key ? createResendDriver(key, from) : createConsoleDriver();
  return cached;
}

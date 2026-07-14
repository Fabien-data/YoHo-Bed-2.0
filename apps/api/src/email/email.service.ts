import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

export interface EmailInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}
export type EmailResult = { ok: true; id: string } | { ok: false; error: string };

interface EmailProvider {
  readonly name: string;
  send(from: string, input: EmailInput): Promise<EmailResult>;
}

/** Dev default: prints the email instead of sending. Keeps the whole flow runnable offline. */
class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  private readonly log = new Logger('Email');
  async send(from: string, input: EmailInput): Promise<EmailResult> {
    this.log.log(`(console) to=${input.to} subject="${input.subject}" from=${from}`);
    this.log.debug(input.text ?? input.html ?? '');
    return { ok: true, id: `console-${Math.random().toString(36).slice(2, 10)}` };
  }
}

/** Real sending via Resend's REST API (no SDK — one endpoint, plain fetch). */
class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  constructor(private readonly apiKey: string) {}
  async send(from: string, input: EmailInput): Promise<EmailResult> {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject: input.subject,
          ...(input.html ? { html: input.html } : {}),
          ...(input.text ? { text: input.text } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok) return { ok: false, error: data?.message ?? `resend http ${res.status}` };
      return { ok: true, id: data?.id ?? 'unknown' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'network error' };
    }
  }
}

/**
 * The email seam (Compartment H). Providers are swappable via EMAIL_PROVIDER; everything else
 * in the API talks only to this service. Sending never throws — callers get a result and decide
 * what "failed" means for them (a failed booking email must never fail the booking).
 */
@Injectable()
export class EmailService {
  private readonly provider: EmailProvider;
  private readonly from: string;
  readonly webUrl: string;

  constructor(config: ConfigService<Env, true>) {
    const kind = config.get('EMAIL_PROVIDER', { infer: true });
    const apiKey = config.get('RESEND_API_KEY', { infer: true });
    this.from = config.get('EMAIL_FROM', { infer: true });
    this.webUrl = config.get('WEB_URL', { infer: true });
    this.provider =
      kind === 'resend' && apiKey ? new ResendEmailProvider(apiKey) : new ConsoleEmailProvider();
    if (kind === 'resend' && !apiKey) {
      new Logger('Email').warn('EMAIL_PROVIDER=resend but RESEND_API_KEY is unset — using console');
    }
  }

  get providerName(): string {
    return this.provider.name;
  }

  send(input: EmailInput): Promise<EmailResult> {
    return this.provider.send(this.from, input);
  }
}

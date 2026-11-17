import { Inject, Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { renderTemplate } from './email-renderer';
import type {
  AddressedEmail,
  ContactEmailInput,
  EmailSendResult,
  EmailTemplateInputs,
  EmailTemplateName,
  OutgoingEmail,
  TemplateContext,
} from './email.types';

/** Injection token so tests and local development never hit the network. */
export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');

export interface EmailTransport {
  send(input: OutgoingEmail): Promise<{ id: string }>;
}

const DELIVERY_TIMEOUT_MS = 5_000;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LOG_REDACTED = '[redacted]';

export function readBooleanEnv(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined || value.trim().length === 0) return fallback;
  return value.trim().toLowerCase() === 'true';
}

/** Keeps the domain while hiding the local part in delivery logs. */
export function redactEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return LOG_REDACTED;
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}

/** Removes every address from provider error messages before logging. */
export function redactEmails(value: string): string {
  return value.replace(EMAIL_PATTERN, LOG_REDACTED);
}

export class LoggingTransport implements EmailTransport {
  private readonly logger = new Logger(LoggingTransport.name);

  send(input: OutgoingEmail): Promise<{ id: string }> {
    this.logger.log(
      JSON.stringify({
        event: 'email.logged',
        to: redactEmail(input.to),
        subject: input.subject,
      }),
    );
    return Promise.resolve({ id: `log_${Date.now().toString(36)}` });
  }
}

export class ResendTransport implements EmailTransport {
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(input: OutgoingEmail): Promise<{ id: string }> {
    const { data, error } = await this.client.emails.send(
      {
        from: input.from,
        to: input.to,
        replyTo: input.replyTo,
        subject: input.subject,
        html: input.html,
        text: input.text,
      },
      input.idempotencyKey
        ? { idempotencyKey: input.idempotencyKey }
        : undefined,
    );

    if (error) {
      throw new Error(
        `Resend rejected the message (${error.statusCode ?? 'unknown'} ${error.name}): ${error.message}`,
      );
    }
    if (!data?.id) {
      throw new Error('Resend returned no message id');
    }
    return { id: data.id };
  }
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly context: TemplateContext;
  private readonly from: string;
  private readonly defaultReplyTo: string;
  private readonly overrideTo: string | null;

  readonly supportEmail: string;

  constructor(
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
  ) {
    const appName = process.env.APP_NAME?.trim() || 'Clasp Workspace';
    this.supportEmail =
      process.env.SUPPORT_EMAIL?.trim() || 'support@claspworkspace.com';
    this.context = { appName, supportEmail: this.supportEmail };
    this.from =
      process.env.EMAIL_FROM?.trim() || `${appName} <no-reply@localhost>`;
    this.defaultReplyTo =
      process.env.EMAIL_REPLY_TO?.trim() || this.supportEmail;
    this.overrideTo = process.env.EMAIL_OVERRIDE_TO?.trim() || null;

    if (this.overrideTo && process.env.NODE_ENV === 'production') {
      this.logger.warn(
        JSON.stringify({
          event: 'email.override_active',
          message:
            'EMAIL_OVERRIDE_TO is set in production; every message will be redirected.',
        }),
      );
    }
  }

  /**
   * Renders and delivers one template. Delivery failures are logged and
   * swallowed so a provider outage never rolls back a business transaction.
   */
  async send<K extends EmailTemplateName>(
    template: K,
    input: EmailTemplateInputs[K],
  ): Promise<EmailSendResult> {
    const startedAt = Date.now();
    try {
      const rendered = renderTemplate(template, input, this.context);
      const isContact = template === 'contact';
      const recipient = isContact
        ? this.supportEmail
        : (input as AddressedEmail).to;
      const effectiveRecipient = this.overrideTo ?? recipient;
      const replyTo =
        input.replyTo ??
        (isContact
          ? (input as ContactEmailInput).email?.trim() || this.defaultReplyTo
          : this.defaultReplyTo);

      const id = await this.deliver({
        from: this.from,
        to: effectiveRecipient,
        replyTo,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: input.idempotencyKey,
      });

      this.logger.log(
        JSON.stringify({
          event: 'email.sent',
          template,
          tenantId: input.tenantId,
          requestId: input.requestId,
          id,
          durationMs: Date.now() - startedAt,
        }),
      );

      return { delivered: true, id };
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'email.failed',
          template,
          tenantId: input.tenantId,
          requestId: input.requestId,
          durationMs: Date.now() - startedAt,
          reason: redactEmails(
            error instanceof Error ? error.message : String(error),
          ),
        }),
      );
      return { delivered: false };
    }
  }

  private async deliver(input: OutgoingEmail): Promise<string> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Email provider timed out after ${DELIVERY_TIMEOUT_MS}ms`,
              ),
            ),
          DELIVERY_TIMEOUT_MS,
        );
        timer.unref?.();
      });

      const result = await Promise.race([this.transport.send(input), timeout]);
      return result.id;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

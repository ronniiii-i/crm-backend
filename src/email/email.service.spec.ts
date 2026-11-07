import { Logger } from '@nestjs/common';
import {
  EmailService,
  type EmailTransport,
  redactEmail,
  redactEmails,
} from './email.service';
import type { OutgoingEmail } from './email.types';

class FakeTransport implements EmailTransport {
  readonly sent: OutgoingEmail[] = [];

  constructor(
    private readonly failWith: Error | null = null,
    private readonly id = 'fake_message_1',
  ) {}

  async send(input: OutgoingEmail): Promise<{ id: string }> {
    this.sent.push(input);
    if (this.failWith) throw this.failWith;
    return { id: this.id };
  }
}

const ENV_KEYS = [
  'APP_NAME',
  'SUPPORT_EMAIL',
  'EMAIL_FROM',
  'EMAIL_REPLY_TO',
  'EMAIL_OVERRIDE_TO',
];
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

describe('EmailService', () => {
  beforeEach(() => {
    process.env.APP_NAME = 'Clasp Workspace';
    process.env.SUPPORT_EMAIL = 'support@claspworkspace.com';
    process.env.EMAIL_FROM = 'Clasp Workspace <notifications@example.com>';
    process.env.EMAIL_REPLY_TO = '';
    process.env.EMAIL_OVERRIDE_TO = '';
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('renders and delivers a template through the transport', async () => {
    const transport = new FakeTransport();
    const email = new EmailService(transport);

    const result = await email.send('welcome', {
      to: 'owner@example.com',
      name: 'Ada Lovelace',
      workspaceName: 'Acme',
      verifyUrl: 'https://app.example.com/acme/verify-email?token=abc123',
      expiresAt: new Date('2026-11-10T12:00:00Z'),
      tenantId: 'tenant-1',
      idempotencyKey: 'welcome:tenant-1:owner@example.com',
    });

    expect(result).toEqual({ delivered: true, id: 'fake_message_1' });
    expect(transport.sent).toHaveLength(1);
    const message = transport.sent[0];
    expect(message.from).toBe('Clasp Workspace <notifications@example.com>');
    expect(message.to).toBe('owner@example.com');
    expect(message.replyTo).toBe('support@claspworkspace.com');
    expect(message.subject).toBe('Welcome to Clasp Workspace');
    expect(message.html).toContain('Ada Lovelace');
    expect(message.text).toContain('Verify email:');
    expect(message.idempotencyKey).toBe('welcome:tenant-1:owner@example.com');
  });

  it('redirects every message to EMAIL_OVERRIDE_TO when set', async () => {
    process.env.EMAIL_OVERRIDE_TO = 'qa-inbox@example.com';
    const transport = new FakeTransport();
    const email = new EmailService(transport);

    await email.send('password-reset', {
      to: 'real-user@example.com',
      name: 'Grace Hopper',
      workspaceName: 'Acme',
      resetUrl: 'https://app.example.com/acme/reset-password?token=def456',
      expiresAt: new Date('2026-11-10T12:00:00Z'),
    });

    expect(transport.sent[0].to).toBe('qa-inbox@example.com');
    expect(transport.sent[0].html).not.toContain('qa-inbox@example.com');
  });

  it('addresses contact mail to support with the submitter as reply-to', async () => {
    const transport = new FakeTransport();
    const email = new EmailService(transport);

    await email.send('contact', {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      company: 'Analytical Engines',
      topic: 'Billing',
      message: 'Please call me.',
    });

    expect(transport.sent[0].to).toBe('support@claspworkspace.com');
    expect(transport.sent[0].replyTo).toBe('ada@example.com');
    expect(transport.sent[0].subject).toBe('Contact request: Billing');
  });

  it('never throws when the provider fails and logs no recipient address', async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const transport = new FakeTransport(
      new Error('provider rejected real-user@example.com'),
    );
    const email = new EmailService(transport);

    const result = await email.send('password-reset', {
      to: 'real-user@example.com',
      name: 'Grace Hopper',
      workspaceName: 'Acme',
      resetUrl:
        'https://app.example.com/acme/reset-password?token=secret-token',
      expiresAt: new Date('2026-11-10T12:00:00Z'),
      tenantId: 'tenant-1',
    });

    expect(result).toEqual({ delivered: false });
    const logged = errorSpy.mock.calls
      .map((call) => call.map(String).join(' '))
      .join('\n');
    expect(logged).toContain('email.failed');
    expect(logged).toContain('[redacted]');
    expect(logged).not.toContain('real-user@example.com');
    expect(logged).not.toContain('secret-token');

    errorSpy.mockRestore();
  });

  it('redacts addresses for logs while keeping the domain', () => {
    expect(redactEmail('real-user@example.com')).toBe('r***@example.com');
    expect(redactEmails('failed for a@b.co and c@d.org')).toBe(
      'failed for [redacted] and [redacted]',
    );
  });
});

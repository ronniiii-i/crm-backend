import { Test } from '@nestjs/testing';
import { EmailModule } from '../../src/email/email.module';
import {
  EMAIL_TRANSPORT,
  EmailService,
  type EmailTransport,
} from '../../src/email/email.service';
import type { OutgoingEmail } from '../../src/email/email.types';

describe('EmailModule with a fake transport', () => {
  const original = {
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_OVERRIDE_TO: process.env.EMAIL_OVERRIDE_TO,
  };

  beforeEach(() => {
    process.env.SUPPORT_EMAIL = 'support@example.com';
    process.env.EMAIL_FROM = 'Clasp Workspace <notifications@example.com>';
    process.env.EMAIL_OVERRIDE_TO = '';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('injects the transport through EMAIL_TRANSPORT and sends a template', async () => {
    const sent: OutgoingEmail[] = [];
    const fake: EmailTransport = {
      send: jest.fn(async (input: OutgoingEmail) => {
        sent.push(input);
        return { id: 'fake_e2e_1' };
      }),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [EmailModule],
    })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue(fake)
      .compile();

    const email = moduleRef.get(EmailService);
    const result = await email.send('invitation', {
      to: 'invitee@example.com',
      inviteeEmail: 'invitee@example.com',
      inviterName: 'Alan Turing',
      workspaceName: 'Acme',
      roleName: 'Team Lead',
      acceptUrl: 'https://app.example.com/acme/invite/token123',
      expiresAt: new Date('2026-11-10T12:00:00Z'),
    });

    expect(result).toEqual({ delivered: true, id: 'fake_e2e_1' });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('invitee@example.com');
    expect(sent[0].subject).toContain('Alan Turing invited you to Acme');
    expect(sent[0].html).toContain('Accept invitation');
    expect(sent[0].text).toContain(
      'https://app.example.com/acme/invite/token123',
    );

    await moduleRef.close();
  });
});

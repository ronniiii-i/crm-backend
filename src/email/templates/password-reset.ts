import type {
  PasswordResetEmailInput,
  RenderedEmail,
  TemplateContext,
} from '../email.types';
import { formatDate } from '../email-renderer';
import { renderLayout } from './layout';

export function renderPasswordReset(
  input: PasswordResetEmailInput,
  context: TemplateContext,
): RenderedEmail {
  return renderLayout(context, {
    subject: `Reset your ${context.appName} password`,
    heading: 'Reset your password',
    preheader: 'Use the secure link below to choose a new password.',
    greeting: `Hi ${input.name},`,
    paragraphs: [
      `We received a request to reset the password for your ${input.workspaceName} account.`,
      `This link expires on ${formatDate(input.expiresAt)}.`,
    ],
    cta: { label: 'Reset password', url: input.resetUrl },
    footnote:
      'If you did not request a password reset, you can ignore this email. Your password will not change until the link above is used.',
    workspaceName: input.workspaceName,
  });
}

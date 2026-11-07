import type {
  RenderedEmail,
  TemplateContext,
  WelcomeEmailInput,
} from '../email.types';
import { formatDate } from '../email-renderer';
import { renderLayout } from './layout';

export function renderWelcome(
  input: WelcomeEmailInput,
  context: TemplateContext,
): RenderedEmail {
  return renderLayout(context, {
    subject: `Welcome to ${context.appName}`,
    heading: `Welcome, ${input.name}`,
    preheader: `Verify your email to activate ${input.workspaceName}.`,
    paragraphs: [
      `Your workspace ${input.workspaceName} is ready. Verify your email address to activate your account.`,
      `This link expires on ${formatDate(input.expiresAt)}.`,
    ],
    cta: { label: 'Verify email', url: input.verifyUrl },
    footnote:
      'If you did not create this workspace, you can safely ignore this email.',
    workspaceName: input.workspaceName,
  });
}

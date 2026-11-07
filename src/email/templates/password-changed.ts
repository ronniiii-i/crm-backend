import type {
  PasswordChangedEmailInput,
  RenderedEmail,
  TemplateContext,
} from '../email.types';
import { renderLayout } from './layout';

export function renderPasswordChanged(
  input: PasswordChangedEmailInput,
  context: TemplateContext,
): RenderedEmail {
  return renderLayout(context, {
    subject: `Your ${context.appName} password was changed`,
    heading: 'Your password was changed',
    preheader: 'A security notice about your account password.',
    greeting: `Hi ${input.name},`,
    paragraphs: [
      `The password for your ${input.workspaceName} account was just changed.`,
      'For your security, every other active session has been signed out.',
    ],
    cta: { label: 'Sign in', url: input.signInUrl },
    footnote:
      'If you did not make this change, contact your workspace administrator immediately.',
    workspaceName: input.workspaceName,
  });
}

import type {
  InvitationEmailInput,
  RenderedEmail,
  TemplateContext,
} from '../email.types';
import { formatDate } from '../email-renderer';
import { renderLayout } from './layout';

export function renderInvitation(
  input: InvitationEmailInput,
  context: TemplateContext,
): RenderedEmail {
  return renderLayout(context, {
    subject: `${input.inviterName} invited you to ${input.workspaceName}`,
    heading: `You're invited to ${input.workspaceName}`,
    preheader: `Join ${input.workspaceName} as ${input.roleName}.`,
    paragraphs: [
      `${input.inviterName} invited you to join ${input.workspaceName} as ${input.roleName}.`,
      `This invitation expires on ${formatDate(input.expiresAt)}.`,
    ],
    cta: { label: 'Accept invitation', url: input.acceptUrl },
    footnote:
      'This invitation was sent to you by a workspace administrator. If you were not expecting it, you can ignore this email.',
    workspaceName: input.workspaceName,
  });
}

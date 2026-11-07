import type {
  EmailTemplateInputs,
  EmailTemplateName,
  RenderedEmail,
  TemplateContext,
} from './email.types';
import { renderWelcome } from './templates/welcome';
import { renderPasswordReset } from './templates/password-reset';
import { renderPasswordChanged } from './templates/password-changed';
import { renderInvitation } from './templates/invitation';
import { renderLeaveSubmitted } from './templates/leave-submitted';
import { renderLeaveDecision } from './templates/leave-decision';
import { renderTaskAssigned } from './templates/task-assigned';
import { renderContact } from './templates/contact';

/** Escapes every value interpolated into HTML or an HTML attribute. */
export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Stable, timezone-independent date formatting for templates and tests. */
export function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

type RendererMap = {
  [K in EmailTemplateName]: (
    input: EmailTemplateInputs[K],
    context: TemplateContext,
  ) => RenderedEmail;
};

const renderers: RendererMap = {
  welcome: renderWelcome,
  'password-reset': renderPasswordReset,
  'password-changed': renderPasswordChanged,
  invitation: renderInvitation,
  'leave-submitted': renderLeaveSubmitted,
  'leave-decision': renderLeaveDecision,
  'task-assigned': renderTaskAssigned,
  contact: renderContact,
};

export function renderTemplate<K extends EmailTemplateName>(
  name: K,
  input: EmailTemplateInputs[K],
  context: TemplateContext,
): RenderedEmail {
  return renderers[name](input, context);
}

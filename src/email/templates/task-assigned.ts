import type {
  RenderedEmail,
  TaskAssignedEmailInput,
  TemplateContext,
} from '../email.types';
import { formatDate } from '../email-renderer';
import { renderLayout } from './layout';

export function renderTaskAssigned(
  input: TaskAssignedEmailInput,
  context: TemplateContext,
): RenderedEmail {
  const paragraphs = [
    `${input.assignerName} assigned you the task "${input.taskTitle}".`,
  ];
  const details = [{ label: 'Assigned by', value: input.assignerName }];
  if (input.dueDate) {
    const due = formatDate(input.dueDate);
    paragraphs.push(`This task is due on ${due}.`);
    details.push({ label: 'Due date', value: due });
  }

  return renderLayout(context, {
    subject: `New task: ${input.taskTitle}`,
    heading: 'You have a new task',
    preheader: `${input.assignerName} assigned you "${input.taskTitle}".`,
    greeting: `Hi ${input.assigneeName},`,
    paragraphs,
    details,
    cta: { label: 'Open task', url: input.taskUrl },
    workspaceName: input.workspaceName,
  });
}

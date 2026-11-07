import type {
  LeaveSubmittedEmailInput,
  RenderedEmail,
  TemplateContext,
} from '../email.types';
import { formatDate } from '../email-renderer';
import { renderLayout } from './layout';

export function renderLeaveSubmitted(
  input: LeaveSubmittedEmailInput,
  context: TemplateContext,
): RenderedEmail {
  const days = `${input.days} ${input.days === 1 ? 'day' : 'days'}`;
  const dates = `${formatDate(input.startDate)} to ${formatDate(input.endDate)}`;

  return renderLayout(context, {
    subject: `Leave request from ${input.requesterName}`,
    heading: 'Leave request needs your review',
    preheader: `${input.requesterName} submitted a ${input.leaveType} leave request.`,
    greeting: `Hi ${input.approverName},`,
    paragraphs: [
      `${input.requesterName} submitted a ${input.leaveType} leave request for ${dates} (${days}).`,
      `It is awaiting your review at the ${input.stage} stage.`,
    ],
    details: [
      { label: 'Leave type', value: input.leaveType },
      { label: 'Dates', value: dates },
      { label: 'Duration', value: days },
      { label: 'Stage', value: input.stage },
    ],
    cta: { label: 'Review request', url: input.reviewUrl },
    workspaceName: input.workspaceName,
  });
}

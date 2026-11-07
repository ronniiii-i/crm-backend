import type {
  LeaveDecisionEmailInput,
  RenderedEmail,
  TemplateContext,
} from '../email.types';
import { formatDate } from '../email-renderer';
import { renderLayout } from './layout';

const STATUS_LABELS: Record<LeaveDecisionEmailInput['status'], string> = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

export function renderLeaveDecision(
  input: LeaveDecisionEmailInput,
  context: TemplateContext,
): RenderedEmail {
  const status = STATUS_LABELS[input.status];
  const dates = `${formatDate(input.startDate)} to ${formatDate(input.endDate)}`;
  const paragraphs = [
    `${input.decidedByName} ${status} your ${input.leaveType} leave request for ${dates}.`,
  ];
  if (input.note && input.note.trim().length > 0) {
    paragraphs.push(`Note from ${input.decidedByName}: ${input.note.trim()}`);
  }

  return renderLayout(context, {
    subject: `Your leave request was ${status}`,
    heading: `Leave request ${status}`,
    preheader: `Your ${input.leaveType} leave request was ${status}.`,
    greeting: `Hi ${input.requesterName},`,
    paragraphs,
    details: [
      { label: 'Leave type', value: input.leaveType },
      { label: 'Dates', value: dates },
      { label: 'Status', value: status },
    ],
    cta: { label: 'View request', url: input.requestUrl },
    workspaceName: input.workspaceName,
  });
}

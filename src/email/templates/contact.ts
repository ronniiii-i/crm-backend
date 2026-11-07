import type {
  ContactEmailInput,
  RenderedEmail,
  TemplateContext,
} from '../email.types';
import { renderLayout } from './layout';

export function renderContact(
  input: ContactEmailInput,
  context: TemplateContext,
): RenderedEmail {
  const topic = input.topic?.trim() || 'General enquiry';
  const details = [
    { label: 'Name', value: input.name },
    { label: 'Email', value: input.email },
  ];
  if (input.company?.trim()) {
    details.push({ label: 'Company', value: input.company.trim() });
  }
  details.push({ label: 'Topic', value: topic });

  return renderLayout(context, {
    subject: `Contact request: ${topic}`,
    heading: 'New contact request',
    preheader: `${input.name} sent a message through the contact form.`,
    paragraphs: [
      'A message was submitted through the contact form.',
      input.message,
    ],
    details,
    cta: { label: 'Reply by email', url: `mailto:${input.email}` },
    footnote: 'Reply directly to this email to respond to the sender.',
  });
}

/**
 * Typed contracts for the Phase 4 email platform.
 *
 * Every template is a plain TypeScript function returning subject, HTML and a
 * text fallback. There is no runtime template engine, so an unknown template
 * or a missing field is a compile-time error rather than a silently broken
 * email.
 */

export interface TemplateContext {
  appName: string;
  supportEmail: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface EmailMeta {
  /** Tenant the message relates to, used for structured delivery logs. */
  tenantId?: string;
  /** Correlates delivery logs with the originating API request. */
  requestId?: string;
  /** Overrides the default reply-to address (for example a contact form). */
  replyTo?: string;
  /**
   * Stable business identifier used for provider idempotency. Callers should
   * derive it from the template plus a business id, never from the token.
   */
  idempotencyKey?: string;
}

export interface AddressedEmail extends EmailMeta {
  to: string;
}

export interface WelcomeEmailInput extends AddressedEmail {
  name: string;
  workspaceName: string;
  verifyUrl: string;
  expiresAt: Date;
}

export interface PasswordResetEmailInput extends AddressedEmail {
  name: string;
  workspaceName: string;
  resetUrl: string;
  expiresAt: Date;
}

export interface PasswordChangedEmailInput extends AddressedEmail {
  name: string;
  workspaceName: string;
  signInUrl: string;
}

export interface InvitationEmailInput extends AddressedEmail {
  inviteeEmail: string;
  inviterName: string;
  workspaceName: string;
  roleName: string;
  acceptUrl: string;
  expiresAt: Date;
}

export interface LeaveSubmittedEmailInput extends AddressedEmail {
  approverName: string;
  requesterName: string;
  leaveType: string;
  startDate: Date;
  endDate: Date;
  days: number;
  stage: string;
  reviewUrl: string;
  workspaceName?: string;
}

export interface LeaveDecisionEmailInput extends AddressedEmail {
  requesterName: string;
  status: 'APPROVED' | 'REJECTED' | 'CANCELLED';
  decidedByName: string;
  note?: string;
  leaveType: string;
  startDate: Date;
  endDate: Date;
  requestUrl: string;
  workspaceName?: string;
}

export interface TaskAssignedEmailInput extends AddressedEmail {
  assigneeName: string;
  taskTitle: string;
  dueDate?: Date | null;
  assignerName: string;
  taskUrl: string;
  workspaceName?: string;
}

/**
 * Contact form mail is addressed to the support inbox by `EmailService`, so
 * it does not take a caller-supplied `to`.
 */
export interface ContactEmailInput extends EmailMeta {
  name: string;
  email: string;
  company?: string;
  topic?: string;
  message: string;
}

export interface EmailTemplateInputs {
  welcome: WelcomeEmailInput;
  'password-reset': PasswordResetEmailInput;
  'password-changed': PasswordChangedEmailInput;
  invitation: InvitationEmailInput;
  'leave-submitted': LeaveSubmittedEmailInput;
  'leave-decision': LeaveDecisionEmailInput;
  'task-assigned': TaskAssignedEmailInput;
  contact: ContactEmailInput;
}

export type EmailTemplateName = keyof EmailTemplateInputs;

export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
}

export interface EmailSendResult {
  delivered: boolean;
  id?: string;
}

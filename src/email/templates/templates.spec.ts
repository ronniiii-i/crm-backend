import { renderTemplate } from '../email-renderer';
import type { TemplateContext } from '../email.types';

const context: TemplateContext = {
  appName: 'Clasp Workspace',
  supportEmail: 'support@claspworkspace.com',
};

const expiresAt = new Date('2026-11-10T12:00:00Z');

describe('email templates', () => {
  it('renders the welcome email with a verification link', () => {
    const rendered = renderTemplate(
      'welcome',
      {
        to: 'owner@example.com',
        name: 'Ada Lovelace',
        workspaceName: 'Acme',
        verifyUrl: 'https://app.example.com/acme/verify-email?token=abc123',
        expiresAt,
      },
      context,
    );

    expect(rendered.subject).toBe('Welcome to Clasp Workspace');
    expect(rendered.html).toContain('Ada Lovelace');
    expect(rendered.html).toContain('Acme');
    expect(rendered.html).toContain(
      'https://app.example.com/acme/verify-email?token=abc123',
    );
    expect(rendered.html).toContain('2026-11-10');
    expect(rendered.text).toContain('Verify email:');
    expect(rendered).toMatchSnapshot();
  });

  it('renders the password reset email', () => {
    const rendered = renderTemplate(
      'password-reset',
      {
        to: 'user@example.com',
        name: 'Grace Hopper',
        workspaceName: 'Acme',
        resetUrl: 'https://app.example.com/acme/reset-password?token=def456',
        expiresAt,
      },
      context,
    );

    expect(rendered.subject).toBe('Reset your Clasp Workspace password');
    expect(rendered.html).toContain('Reset password');
    expect(rendered.html).toContain('Grace Hopper');
    expect(rendered).toMatchSnapshot();
  });

  it('renders the post-reset security notice', () => {
    const rendered = renderTemplate(
      'password-changed',
      {
        to: 'user@example.com',
        name: 'Grace Hopper',
        workspaceName: 'Acme',
        signInUrl: 'https://app.example.com/acme/login',
      },
      context,
    );

    expect(rendered.subject).toBe('Your Clasp Workspace password was changed');
    expect(rendered.html).toContain('every other active session');
    expect(rendered).toMatchSnapshot();
  });

  it('renders the invitation email', () => {
    const rendered = renderTemplate(
      'invitation',
      {
        to: 'invitee@example.com',
        inviteeEmail: 'invitee@example.com',
        inviterName: 'Alan Turing',
        workspaceName: 'Acme',
        roleName: 'Team Lead',
        acceptUrl: 'https://app.example.com/acme/invite/tok123',
        expiresAt,
      },
      context,
    );

    expect(rendered.subject).toBe('Alan Turing invited you to Acme');
    expect(rendered.html).toContain('Team Lead');
    expect(rendered.html).toContain('Accept invitation');
    expect(rendered).toMatchSnapshot();
  });

  it('renders a leave request for the current approver', () => {
    const rendered = renderTemplate(
      'leave-submitted',
      {
        to: 'lead@example.com',
        approverName: 'Team Lead',
        requesterName: 'Ada Lovelace',
        leaveType: 'Annual',
        startDate: new Date('2026-11-12T00:00:00Z'),
        endDate: new Date('2026-11-14T00:00:00Z'),
        days: 3,
        stage: 'Team Lead',
        reviewUrl: 'https://app.example.com/acme/leave/req1',
        workspaceName: 'Acme',
      },
      context,
    );

    expect(rendered.subject).toBe('Leave request from Ada Lovelace');
    expect(rendered.html).toContain('3 days');
    expect(rendered.html).toContain('Review request');
    expect(rendered).toMatchSnapshot();
  });

  it('renders a leave decision with an optional note', () => {
    const rendered = renderTemplate(
      'leave-decision',
      {
        to: 'requester@example.com',
        requesterName: 'Ada Lovelace',
        status: 'APPROVED',
        decidedByName: 'HR Lead',
        note: 'Enjoy the break.',
        leaveType: 'Annual',
        startDate: new Date('2026-11-12T00:00:00Z'),
        endDate: new Date('2026-11-14T00:00:00Z'),
        requestUrl: 'https://app.example.com/acme/leave/req1',
        workspaceName: 'Acme',
      },
      context,
    );

    expect(rendered.subject).toBe('Your leave request was approved');
    expect(rendered.html).toContain('Enjoy the break.');
    expect(rendered).toMatchSnapshot();
  });

  it('renders a task assignment with a due date', () => {
    const rendered = renderTemplate(
      'task-assigned',
      {
        to: 'assignee@example.com',
        assigneeName: 'Ada Lovelace',
        taskTitle: 'Ship the release',
        dueDate: new Date('2026-11-20T00:00:00Z'),
        assignerName: 'Grace Hopper',
        taskUrl: 'https://app.example.com/acme/tasks/task1',
        workspaceName: 'Acme',
      },
      context,
    );

    expect(rendered.subject).toBe('New task: Ship the release');
    expect(rendered.html).toContain('2026-11-20');
    expect(rendered).toMatchSnapshot();
  });

  it('renders a contact request with a mailto reply action', () => {
    const rendered = renderTemplate(
      'contact',
      {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        company: 'Analytical Engines',
        topic: 'Billing',
        message: 'Please call me.',
      },
      context,
    );

    expect(rendered.subject).toBe('Contact request: Billing');
    expect(rendered.html).toContain('mailto:ada@example.com');
    expect(rendered.html).toContain('Please call me.');
    expect(rendered).toMatchSnapshot();
  });

  it('escapes every interpolated value', () => {
    const rendered = renderTemplate(
      'welcome',
      {
        to: 'owner@example.com',
        name: '<script>alert("x")</script>',
        workspaceName: 'Acme & Co',
        verifyUrl: 'https://app.example.com/acme/verify-email?token=a&b',
        expiresAt,
      },
      context,
    );

    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).toContain('Acme &amp; Co');
    expect(rendered.html).toContain('token=a&amp;b');
  });
});

import type { RenderedEmail, TemplateContext } from '../email.types';
import { escapeHtml } from '../email-renderer';

export interface LayoutDetail {
  label: string;
  value: string;
}

export interface LayoutOptions {
  subject: string;
  heading: string;
  preheader?: string;
  greeting?: string;
  paragraphs?: string[];
  details?: LayoutDetail[];
  cta?: { label: string; url: string };
  workspaceName?: string;
  footnote?: string;
}

/**
 * Single shared layout. It renders the product name, one primary button, the
 * workspace name and a support footer, and produces a readable text fallback.
 */
export function renderLayout(
  context: TemplateContext,
  options: LayoutOptions,
): RenderedEmail {
  const appName = escapeHtml(context.appName);
  const supportEmail = escapeHtml(context.supportEmail);
  const heading = escapeHtml(options.heading);
  const preheader = escapeHtml(options.preheader ?? options.heading);
  const greeting = options.greeting ? escapeHtml(options.greeting) : null;
  const paragraphs = (options.paragraphs ?? []).map((paragraph) =>
    escapeHtml(paragraph),
  );
  const details = (options.details ?? []).map((detail) => ({
    label: escapeHtml(detail.label),
    value: escapeHtml(detail.value),
  }));
  const footnote = options.footnote ? escapeHtml(options.footnote) : null;
  const workspaceName = options.workspaceName
    ? escapeHtml(options.workspaceName)
    : null;
  const cta = options.cta
    ? {
        label: escapeHtml(options.cta.label),
        url: escapeHtml(options.cta.url),
      }
    : null;

  const detailRows = details
    .map(
      (detail) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:14px;vertical-align:top;">${detail.label}</td>` +
        `<td style="padding:4px 0;color:#0f172a;font-size:14px;vertical-align:top;">${detail.value}</td></tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${heading}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1f5f9;">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
            <tr>
              <td style="padding:24px 32px 8px 32px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#2563eb;">${appName}</td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px 32px;">
                <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">${heading}</h1>
                ${greeting ? `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">${greeting}</p>` : ''}
                ${paragraphs
                  .map(
                    (paragraph) =>
                      `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">${paragraph}</p>`,
                  )
                  .join('')}
                ${
                  detailRows
                    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0;padding:12px 16px;background-color:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">${detailRows}</table>`
                    : ''
                }
                ${
                  cta
                    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 8px 0;"><tr><td style="border-radius:8px;background-color:#2563eb;"><a href="${cta.url}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${cta.label}</a></td></tr></table>`
                    : ''
                }
                ${footnote ? `<p style="margin:20px 0 0 0;font-size:13px;line-height:1.5;color:#64748b;">${footnote}</p>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 24px 32px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.6;">
                ${workspaceName ? `<div style="margin-bottom:4px;color:#475569;font-weight:600;">${workspaceName}</div>` : ''}
                <div>${appName} &middot; Need help? <a href="mailto:${supportEmail}" style="color:#2563eb;text-decoration:none;">${supportEmail}</a></div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textLines = [options.heading, ''];
  if (options.greeting) textLines.push(options.greeting, '');
  for (const paragraph of options.paragraphs ?? []) {
    textLines.push(paragraph, '');
  }
  for (const detail of options.details ?? []) {
    textLines.push(`${detail.label}: ${detail.value}`);
  }
  if (options.details?.length) textLines.push('');
  if (options.cta) {
    textLines.push(`${options.cta.label}: ${options.cta.url}`, '');
  }
  if (options.footnote) textLines.push(options.footnote, '');
  if (options.workspaceName) textLines.push(options.workspaceName);
  textLines.push(context.appName, `Support: ${context.supportEmail}`);

  return {
    subject: options.subject,
    html,
    text: textLines.join('\n'),
  };
}

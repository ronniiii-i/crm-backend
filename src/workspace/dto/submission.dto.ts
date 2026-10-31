import { BadRequestException } from '@nestjs/common';

export interface SubmissionInput {
  data: Record<string, unknown>;
}

/**
 * Accept either `{ data: {...} }` (the documented shape) or a flat object
 * from simple HTML forms. Unknown top-level control keys are rejected so a
 * stray `id` can never be stored as form data.
 */
const ENVELOPE_KEYS = new Set(['data']);

export function parseSubmissionBody(body: unknown): SubmissionInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid('Submission body must be a JSON object.');
  }

  const entry = body as Record<string, unknown>;
  const hasEnvelope = Object.prototype.hasOwnProperty.call(entry, 'data');

  let data: unknown = entry;

  if (hasEnvelope) {
    const extra = Object.keys(entry).filter((key) => !ENVELOPE_KEYS.has(key));
    if (extra.length > 0) {
      throw invalid(`Unknown keys: ${extra.join(', ')}.`);
    }
    data = entry.data;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw invalid('Submission data must be a JSON object.');
  }

  const values = data as Record<string, unknown>;
  if (Object.keys(values).length === 0) {
    throw invalid('Submission data must contain at least one value.');
  }
  if (JSON.stringify(values).length > 100 * 1024) {
    throw invalid('Submission data exceeds the 100 KB limit.');
  }

  return { data: values };
}

export function submissionInvalid(message: string): BadRequestException {
  return invalid(message);
}

function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: 'INVALID_SUBMISSION', message });
}

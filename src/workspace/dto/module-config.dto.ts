import { BadRequestException } from '@nestjs/common';

/** Extract a module config object from a `PATCH .../config` body. */
export function parseConfigBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException({
      code: 'INVALID_MODULE_CONFIG',
      message: 'Module config must be a JSON object.',
    });
  }

  const entry = body as Record<string, unknown>;

  // Accept both the raw config object and `{ config: {...} }`.
  if (
    entry.config &&
    typeof entry.config === 'object' &&
    !Array.isArray(entry.config)
  ) {
    return entry.config as Record<string, unknown>;
  }

  return entry;
}

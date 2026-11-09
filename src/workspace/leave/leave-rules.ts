/**
 * Pure date helpers for the leave workflow.
 *
 * Leave days are counted in calendar days (Monday-Friday inclusive) using UTC
 * midnights. Attendance rows are stored with the same UTC midnight so the
 * unique `(tenantId, userId, date)` constraint can be used for idempotent
 * materialisation regardless of the server timezone.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Parse an ISO date or date-only string into a UTC-midnight Date. */
export function parseLeaveDate(value: unknown): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return startOfUtcDay(value);
  }

  if (typeof value !== 'string' || value.trim().length === 0) return null;

  const text = value.trim();
  const parsed = DATE_ONLY.test(text)
    ? new Date(`${text}T00:00:00.000Z`)
    : new Date(text);

  if (Number.isNaN(parsed.getTime())) return null;
  return startOfUtcDay(parsed);
}

export function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

export function isWeekend(value: Date): boolean {
  const day = value.getUTCDay();
  return day === 0 || day === 6;
}

/** Count working days (Mon-Fri) between two dates, inclusive. */
export function workingDays(start: Date, end: Date): number {
  const from = startOfUtcDay(start).getTime();
  const to = startOfUtcDay(end).getTime();
  if (to < from) return 0;

  let count = 0;
  for (let time = from; time <= to; time += DAY_MS) {
    if (!isWeekend(new Date(time))) count += 1;
  }
  return count;
}

/** Every working day in the range, as UTC midnights. */
export function eachWorkingDay(start: Date, end: Date): Date[] {
  const from = startOfUtcDay(start).getTime();
  const to = startOfUtcDay(end).getTime();
  if (to < from) return [];

  const days: Date[] = [];
  for (let time = from; time <= to; time += DAY_MS) {
    const date = new Date(time);
    if (!isWeekend(date)) days.push(date);
  }
  return days;
}

/** True when the date is strictly before the current UTC day. */
export function isPastDate(value: Date, now = new Date()): boolean {
  return startOfUtcDay(value).getTime() < startOfUtcDay(now).getTime();
}

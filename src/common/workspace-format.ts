/**
 * Server-side counterpart of the frontend workspace formatter.
 *
 * Currency, numbers and timestamps follow the tenant preferences so CSV
 * exports and transactional email match what the user sees in the app.
 * Date-only strings (`YYYY-MM-DD`) are treated as calendar dates and are
 * formatted in UTC to avoid the one-day shift a timezone conversion causes.
 */

export interface WorkspaceFormatSettings {
  currency: string;
  currencySymbol?: string | null;
  dateFormat: string;
  timeZone: string;
  locale: string;
  weekStartsOn: number;
}

export const DEFAULT_WORKSPACE_FORMAT: WorkspaceFormatSettings = {
  currency: 'USD',
  currencySymbol: null,
  dateFormat: 'd MMM yyyy',
  timeZone: 'UTC',
  locale: 'en-US',
  weekStartsOn: 1,
};

type DateInput = string | number | Date | null | undefined;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_PATTERN = /(MMMM|MMM|MM|dd|d|yyyy)/g;

function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function toDate(value: DateInput, dateOnly: boolean): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === 'number'
        ? new Date(value)
        : dateOnly
          ? new Date(`${value}T12:00:00.000Z`)
          : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parts(
  date: Date,
  timeZone: string,
  locale: string,
): {
  day: string;
  month: string;
  monthShort: string;
  monthLong: string;
  year: string;
  hour: string;
  minute: string;
} {
  const zone = safeTimeZone(timeZone);
  const base = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const read = (type: string) =>
    base.find((part) => part.type === type)?.value ?? '';

  return {
    day: read('day'),
    month: read('month'),
    monthShort: new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      month: 'short',
    }).format(date),
    monthLong: new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      month: 'long',
    }).format(date),
    year: read('year'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

export function formatWorkspaceDate(
  value: DateInput,
  settings: WorkspaceFormatSettings = DEFAULT_WORKSPACE_FORMAT,
  fallback = '—',
): string {
  const dateOnly = typeof value === 'string' && DATE_ONLY_PATTERN.test(value);
  const date = toDate(value, dateOnly);
  if (!date) return fallback;

  const timeZone = dateOnly ? 'UTC' : settings.timeZone;
  const pieces = parts(date, timeZone, settings.locale);
  const pattern = settings.dateFormat || DEFAULT_WORKSPACE_FORMAT.dateFormat;

  return pattern.replace(TOKEN_PATTERN, (token) => {
    switch (token) {
      case 'yyyy':
        return pieces.year;
      case 'MMMM':
        return pieces.monthLong;
      case 'MMM':
        return pieces.monthShort;
      case 'MM':
        return pieces.month;
      case 'dd':
        return pieces.day.padStart(2, '0');
      case 'd':
        return String(Number(pieces.day));
      default:
        return token;
    }
  });
}

export function formatWorkspaceDateTime(
  value: DateInput,
  settings: WorkspaceFormatSettings = DEFAULT_WORKSPACE_FORMAT,
  fallback = '—',
): string {
  const dateOnly = typeof value === 'string' && DATE_ONLY_PATTERN.test(value);
  const date = toDate(value, dateOnly);
  if (!date) return fallback;

  const timeZone = dateOnly ? 'UTC' : settings.timeZone;
  const pieces = parts(date, timeZone, settings.locale);
  const time = `${pieces.hour.padStart(2, '0')}:${pieces.minute.padStart(2, '0')}`;
  return `${formatWorkspaceDate(value, settings, fallback)}, ${time}`;
}

export function formatWorkspaceCurrency(
  value: number | string | null | undefined,
  settings: WorkspaceFormatSettings = DEFAULT_WORKSPACE_FORMAT,
  fallback = '—',
  options: { compact?: boolean } = {},
): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;

  if (settings.currencySymbol) {
    const number = new Intl.NumberFormat(settings.locale, {
      notation: options.compact ? 'compact' : 'standard',
      maximumFractionDigits: options.compact ? 1 : 2,
    }).format(numeric);
    return `${settings.currencySymbol}${number}`;
  }

  try {
    return new Intl.NumberFormat(settings.locale, {
      style: 'currency',
      currency: settings.currency,
      currencyDisplay: 'narrowSymbol',
      notation: options.compact ? 'compact' : 'standard',
      maximumFractionDigits: options.compact ? 1 : 2,
    }).format(numeric);
  } catch {
    return `${settings.currency} ${numeric}`;
  }
}

export function formatWorkspaceNumber(
  value: number | string | null | undefined,
  settings: WorkspaceFormatSettings = DEFAULT_WORKSPACE_FORMAT,
  fallback = '—',
  options: { compact?: boolean; maximumFractionDigits?: number } = {},
): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return new Intl.NumberFormat(settings.locale, {
    notation: options.compact ? 'compact' : 'standard',
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  }).format(numeric);
}

import { BadRequestException } from '@nestjs/common';

/**
 * Workspace preference validation and helpers shared by the settings API and
 * the login/refresh payload.
 */

export const SUPPORTED_CURRENCIES = [
  'NGN',
  'USD',
  'GBP',
  'EUR',
  'CAD',
  'AUD',
  'ZAR',
  'KES',
  'GHS',
  'INR',
] as const;

export const DATE_FORMATS = [
  'd MMM yyyy',
  'dd/MM/yyyy',
  'MM/dd/yyyy',
  'yyyy-MM-dd',
  'd MMMM yyyy',
] as const;

export const SUPPORTED_LOCALES = [
  'en-NG',
  'en-US',
  'en-GB',
  'fr-FR',
  'ar-EG',
] as const;

export interface TenantWorkspaceSettings {
  name?: string;
  slug?: string;
  currency: string;
  currencySymbol: string | null;
  dateFormat: string;
  timeZone: string;
  locale: string;
  weekStartsOn: number;
}

export interface TenantSettingsPatch {
  name?: string;
  currency?: string;
  currencySymbol?: string | null;
  dateFormat?: string;
  timeZone?: string;
  locale?: string;
  weekStartsOn?: number;
}

export function deriveCurrencySymbol(currency: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function isValidLocale(locale: string): boolean {
  try {
    new Intl.NumberFormat(locale);
    return true;
  } catch {
    return false;
  }
}

function invalid(field: string, message: string): never {
  throw new BadRequestException(`${field}: ${message}`);
}

/**
 * Validate a partial settings patch. Unknown keys are ignored by the caller;
 * values that are present must be valid or the whole request is rejected.
 */
export function validateTenantSettingsPatch(
  body: Record<string, unknown>,
): TenantSettingsPatch {
  const patch: TenantSettingsPatch = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      invalid('name', 'workspace name cannot be empty');
    }
    if (body.name.trim().length > 120) {
      invalid('name', 'workspace name is too long');
    }
    patch.name = body.name.trim();
  }

  if (body.currency !== undefined) {
    if (typeof body.currency !== 'string') {
      invalid('currency', 'must be a string');
    }
    const currency = body.currency.trim().toUpperCase();
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
      invalid('currency', 'unsupported currency');
    }
    patch.currency = currency;
  }

  if (body.currencySymbol !== undefined) {
    if (body.currencySymbol === null || body.currencySymbol === '') {
      patch.currencySymbol = null;
    } else if (typeof body.currencySymbol !== 'string') {
      invalid('currencySymbol', 'must be a string');
    } else {
      const symbol = body.currencySymbol.trim();
      if ([...symbol].length > 3) {
        invalid('currencySymbol', 'must be at most 3 characters');
      }
      patch.currencySymbol = symbol || null;
    }
  }

  if (body.dateFormat !== undefined) {
    if (
      typeof body.dateFormat !== 'string' ||
      !(DATE_FORMATS as readonly string[]).includes(body.dateFormat)
    ) {
      invalid('dateFormat', 'unsupported date format');
    }
    patch.dateFormat = body.dateFormat;
  }

  if (body.timeZone !== undefined) {
    if (typeof body.timeZone !== 'string' || !isValidTimeZone(body.timeZone)) {
      invalid('timeZone', 'invalid IANA timezone');
    }
    patch.timeZone = body.timeZone;
  }

  if (body.locale !== undefined) {
    if (typeof body.locale !== 'string' || !isValidLocale(body.locale)) {
      invalid('locale', 'invalid locale');
    }
    patch.locale = body.locale;
  }

  if (body.weekStartsOn !== undefined) {
    const value = Number(body.weekStartsOn);
    if (!Number.isInteger(value) || value < 0 || value > 6) {
      invalid('weekStartsOn', 'must be an integer from 0 to 6');
    }
    patch.weekStartsOn = value;
  }

  return patch;
}

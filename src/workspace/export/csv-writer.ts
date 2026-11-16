/**
 * RFC 4180 CSV primitives shared by the workspace export endpoint.
 *
 * Excel interprets a leading `=`, `+`, `-`, `@`, tab or carriage return as a
 * formula, so user-supplied strings that start with one of those characters
 * are prefixed with an apostrophe. Numbers are never treated as formula text,
 * so negative numeric cells keep their sign.
 */

export const UTF8_BOM = '\uFEFF';
export const CSV_NEWLINE = '\r\n';

export type CsvValue = string | number | boolean | Date | null | undefined;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function toText(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  return String(value);
}

/** Apply the formula-injection guard to a user-controlled string cell. */
export function guardFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

/** Quote one cell according to RFC 4180. */
export function escapeCsvValue(value: CsvValue): string {
  const text = toText(value);
  const guarded =
    typeof value === 'string' || value === null || value === undefined
      ? guardFormula(text)
      : text;

  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** Serialise one row, including the trailing CRLF. */
export function formatCsvRow(values: CsvValue[]): string {
  return `${values.map(escapeCsvValue).join(',')}${CSV_NEWLINE}`;
}

/**
 * Stateful serialiser that emits the UTF-8 BOM exactly once, immediately
 * before the header row. The caller owns writing and backpressure, which keeps
 * this class synchronous and easy to unit test.
 */
export class CsvWriter {
  private started = false;

  header(labels: string[]): string {
    return `${this.start()}${formatCsvRow(labels)}`;
  }

  row(values: CsvValue[]): string {
    return `${this.start()}${formatCsvRow(values)}`;
  }

  private start(): string {
    if (this.started) return '';
    this.started = true;
    return UTF8_BOM;
  }
}

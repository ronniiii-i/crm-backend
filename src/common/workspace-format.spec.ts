import {
  DEFAULT_WORKSPACE_FORMAT,
  formatWorkspaceCurrency,
  formatWorkspaceDate,
  formatWorkspaceDateTime,
  formatWorkspaceNumber,
} from './workspace-format';

const lagos = {
  ...DEFAULT_WORKSPACE_FORMAT,
  currency: 'NGN',
  currencySymbol: '₦',
  dateFormat: 'dd/MM/yyyy',
  timeZone: 'Africa/Lagos',
  locale: 'en-NG',
};

describe('workspace format', () => {
  it('formats a date-only value as a calendar date', () => {
    expect(formatWorkspaceDate('2026-11-06', DEFAULT_WORKSPACE_FORMAT)).toBe(
      '6 Nov 2026',
    );
  });

  it('does not shift a date-only value into the previous day', () => {
    expect(
      formatWorkspaceDate('2026-01-01', {
        ...DEFAULT_WORKSPACE_FORMAT,
        timeZone: 'America/Los_Angeles',
      }),
    ).toBe('1 Jan 2026');
  });

  it('applies the configured date pattern', () => {
    expect(
      formatWorkspaceDate('2026-11-06', {
        ...lagos,
        dateFormat: 'yyyy-MM-dd',
      }),
    ).toBe('2026-11-06');
  });

  it('converts timestamps into the workspace timezone', () => {
    const value = '2026-11-06T23:30:00.000Z';
    expect(formatWorkspaceDate(value, lagos)).toBe('07/11/2026');
    expect(formatWorkspaceDateTime(value, lagos)).toBe('07/11/2026, 00:30');
  });

  it('formats currency with the workspace locale and symbol', () => {
    expect(formatWorkspaceCurrency(1250000, lagos)).toBe('₦1,250,000');
    expect(
      formatWorkspaceCurrency(2500, { ...lagos, currencySymbol: null }),
    ).toContain('₦');
  });

  it('formats compact currency for dashboard metrics', () => {
    expect(
      formatWorkspaceCurrency(1_250_000, DEFAULT_WORKSPACE_FORMAT, '—', {
        compact: true,
      }),
    ).toBe('$1.3M');
  });

  it('formats numbers with the workspace locale', () => {
    expect(formatWorkspaceNumber(1234567.89, lagos)).toBe('1,234,567.89');
  });
});

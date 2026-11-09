import {
  eachWorkingDay,
  isPastDate,
  isWeekend,
  parseLeaveDate,
  startOfUtcDay,
  workingDays,
} from './leave-rules';

const utc = (text: string) => new Date(`${text}T00:00:00.000Z`);

describe('leave date rules', () => {
  it('parses date-only strings as UTC midnight', () => {
    expect(parseLeaveDate('2026-11-09')).toEqual(utc('2026-11-09'));
    expect(parseLeaveDate('2026-11-09T15:30:00.000Z')).toEqual(
      utc('2026-11-09'),
    );
    expect(parseLeaveDate('')).toBeNull();
    expect(parseLeaveDate('not-a-date')).toBeNull();
  });

  it('normalises to the UTC day', () => {
    expect(startOfUtcDay(new Date('2026-11-09T23:59:59.999Z'))).toEqual(
      utc('2026-11-09'),
    );
  });

  it('identifies weekends', () => {
    expect(isWeekend(utc('2026-11-07'))).toBe(true); // Saturday
    expect(isWeekend(utc('2026-11-08'))).toBe(true); // Sunday
    expect(isWeekend(utc('2026-11-09'))).toBe(false); // Monday
  });

  it('counts Monday-Friday inclusive', () => {
    // Monday 9 Nov to Friday 13 Nov 2026.
    expect(workingDays(utc('2026-11-09'), utc('2026-11-13'))).toBe(5);
    // Friday to Monday includes the weekend, not the weekend days.
    expect(workingDays(utc('2026-11-13'), utc('2026-11-16'))).toBe(2);
    // Weekend-only range has no working days.
    expect(workingDays(utc('2026-11-07'), utc('2026-11-08'))).toBe(0);
    // Reversed range is empty.
    expect(workingDays(utc('2026-11-13'), utc('2026-11-09'))).toBe(0);
  });

  it('materialises each working day as UTC midnight', () => {
    expect(eachWorkingDay(utc('2026-11-13'), utc('2026-11-16'))).toEqual([
      utc('2026-11-13'),
      utc('2026-11-16'),
    ]);
  });

  it('detects strictly past dates relative to the UTC day', () => {
    const now = new Date('2026-11-09T18:00:00.000Z');
    expect(isPastDate(utc('2026-11-08'), now)).toBe(true);
    expect(isPastDate(utc('2026-11-09'), now)).toBe(false);
    expect(isPastDate(utc('2026-11-10'), now)).toBe(false);
  });
});

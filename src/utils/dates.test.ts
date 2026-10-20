import { describe, it, expect } from 'vitest';
import { formatEventDateRange, formatEventDayShort } from './dates';

describe('formatEventDateRange', () => {
  it('returns a single formatted date when no endDate is given', () => {
    const d = new Date('2026-06-14T00:00:00Z');
    expect(formatEventDateRange(d)).toBe('June 14, 2026');
  });

  it('uses short month style when monthStyle is "short"', () => {
    const d = new Date('2026-06-14T00:00:00Z');
    expect(formatEventDateRange(d, undefined, 'short')).toBe('Jun 14, 2026');
  });

  it('collapses same-month same-year range to "Month D1–D2, Year"', () => {
    const start = new Date('2026-06-14T00:00:00Z');
    const end = new Date('2026-06-16T00:00:00Z');
    expect(formatEventDateRange(start, end)).toBe('June 14–16, 2026');
  });

  it('uses short month in collapsed same-month range', () => {
    const start = new Date('2026-06-14T00:00:00Z');
    const end = new Date('2026-06-16T00:00:00Z');
    expect(formatEventDateRange(start, end, 'short')).toBe('Jun 14–16, 2026');
  });

  it('formats a cross-month same-year range as two full dates', () => {
    const start = new Date('2026-06-14T00:00:00Z');
    const end = new Date('2026-07-02T00:00:00Z');
    expect(formatEventDateRange(start, end)).toBe('June 14, 2026 – July 2, 2026');
  });

  it('formats a cross-year range as two full dates', () => {
    const start = new Date('2025-12-31T00:00:00Z');
    const end = new Date('2026-01-01T00:00:00Z');
    expect(formatEventDateRange(start, end)).toBe('December 31, 2025 – January 1, 2026');
  });
});

describe('formatEventDayShort', () => {
  it('formats month and day only', () => {
    expect(formatEventDayShort(new Date('2026-12-27'))).toBe('Dec 27');
  });

  it('uses the UTC date so midnight UTC does not roll back a day', () => {
    expect(formatEventDayShort(new Date('2026-01-01T00:00:00Z'))).toBe('Jan 1');
  });
});

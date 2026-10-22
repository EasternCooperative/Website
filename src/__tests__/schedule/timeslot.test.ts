import { describe, it, expect } from 'vitest';
import { formatTimeRange } from '~/components/schedule/timeUtils';

describe('formatTimeRange', () => {
  it('formats morning times correctly', () => {
    expect(formatTimeRange('09:00', '10:30')).toBe('9:00 AM - 10:30 AM');
  });

  it('formats afternoon times correctly', () => {
    expect(formatTimeRange('14:15', '16:45')).toBe('2:15 PM - 4:45 PM');
  });

  it('formats midnight as 12:00 AM', () => {
    expect(formatTimeRange('00:00', '01:00')).toBe('12:00 AM - 1:00 AM');
  });

  it('formats noon as 12:00 PM', () => {
    expect(formatTimeRange('12:00', '13:30')).toBe('12:00 PM - 1:30 PM');
  });

  it('formats AM-to-PM span correctly', () => {
    expect(formatTimeRange('11:30', '13:00')).toBe('11:30 AM - 1:00 PM');
  });

  it('formats early morning times', () => {
    expect(formatTimeRange('06:30', '08:00')).toBe('6:30 AM - 8:00 AM');
  });

  it('formats late evening times', () => {
    expect(formatTimeRange('20:00', '22:30')).toBe('8:00 PM - 10:30 PM');
  });

  it('formats exact hour with zero minutes', () => {
    expect(formatTimeRange('10:00', '11:00')).toBe('10:00 AM - 11:00 AM');
  });

  it('returns empty string when both times are empty', () => {
    expect(formatTimeRange('', '')).toBe('');
  });

  it('returns empty string when start time is missing', () => {
    expect(formatTimeRange('', '10:00')).toBe('');
  });

  it('returns just the start time when end time is missing', () => {
    expect(formatTimeRange('09:00', '')).toBe('9:00 AM');
  });
});

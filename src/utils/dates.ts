const UTC: Intl.DateTimeFormatOptions = { timeZone: 'UTC' };

export function formatEventDateRange(date: Date, endDate?: Date, monthStyle: 'long' | 'short' = 'long'): string {
  const opts = {
    month: monthStyle as Intl.DateTimeFormatOptions['month'],
    day: 'numeric' as const,
    year: 'numeric' as const,
    ...UTC,
  };
  const start = date.toLocaleDateString('en-US', opts);
  if (!endDate) return start;
  const sm = date.toLocaleDateString('en-US', { month: monthStyle, ...UTC });
  const em = endDate.toLocaleDateString('en-US', { month: monthStyle, ...UTC });
  const sy = date.toLocaleDateString('en-US', { year: 'numeric', ...UTC });
  const ey = endDate.toLocaleDateString('en-US', { year: 'numeric', ...UTC });
  if (sm === em && sy === ey) {
    const d1 = date.toLocaleDateString('en-US', { day: 'numeric', ...UTC });
    const d2 = endDate.toLocaleDateString('en-US', { day: 'numeric', ...UTC });
    return `${sm} ${d1}–${d2}, ${sy}`;
  }
  return `${start} – ${endDate.toLocaleDateString('en-US', opts)}`;
}

/** "Dec 27": month and day only, for labelling a start or end time on a multi-day event. */
export function formatEventDayShort(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...UTC });
}

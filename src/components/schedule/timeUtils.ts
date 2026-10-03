export function formatTime(time: string): string {
  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
}

// A start with no end (e.g. a meal) shows just the start time.
export function formatTimeRange(startTime: string, endTime: string): string {
  if (!startTime) return '';
  if (!endTime) return formatTime(startTime);
  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

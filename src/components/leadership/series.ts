// Recurring events ("Winter Adventure", "Camping Weekend") and the places they happen.
// Staffing is planned for the next one of a series, which may not be on the calendar yet.

import type { EventRow } from './model';

/** Which recurring event a name belongs to, or null for virtual and unnamed events. */
export function seriesOf(name: string): string | null {
  const n = name.toLowerCase();
  if (/virtual|zoom/.test(n)) return null;
  if (/winter (adventure|workshop)/.test(n)) return 'Winter Adventure';
  if (/camping weekend|summer weekend/.test(n)) return 'Camping Weekend';
  if (/spring weekend/.test(n)) return 'Spring Weekend';
  if (/fall weekend/.test(n)) return 'Fall Weekend';
  if (/summer school/.test(n)) return 'Summer School';
  if (/fun day/.test(n)) return 'Fun Day';
  const plain = name
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\s+at\s+.*$/i, '')
    .replace(/\s*-\s*\d{1,2}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return plain || null;
}

export interface SeriesInfo {
  name: string;
  /** Every dated occurrence, newest first. */
  events: EventRow[];
  /** The next one already on the calendar, if any. */
  upcoming: EventRow | null;
  /** The most recent one that happened. */
  last: EventRow | null;
}

/** The recurring events, with the one most recently held or coming up first. */
export function seriesList(events: EventRow[], today: string): SeriesInfo[] {
  const by = new Map<string, EventRow[]>();
  for (const e of events) {
    const s = seriesOf(e.name);
    if (s) by.set(s, [...(by.get(s) ?? []), e]);
  }
  const out: SeriesInfo[] = [];
  for (const [name, list] of by) {
    const dated = list
      .filter((e) => e.start_date)
      .sort((a, b) => (b.start_date as string).localeCompare(a.start_date as string) || b.id - a.id);
    if (!dated.length) continue;
    const upcoming = [...dated].reverse().find((e) => (e.start_date as string) >= today) ?? null;
    out.push({ name, events: dated, upcoming, last: dated.find((e) => (e.start_date as string) < today) ?? null });
  }
  return out.sort((a, b) => ((b.events[0].start_date as string) < (a.events[0].start_date as string) ? -1 : 1));
}

/**
 * When the next one probably is: the one already on the calendar, or the last one's month and
 * day in the next year it has not passed. Leap days fall back to the 28th.
 */
export function suggestedDate(info: SeriesInfo, today: string): string {
  if (info.upcoming) return info.upcoming.start_date as string;
  // With no upcoming one, every occurrence is in the past, so there is a last one.
  const ref = (info.last as EventRow).start_date as string;
  const [md, y0] = [ref.slice(5), Number(today.slice(0, 4))];
  for (let y = y0; ; y++) {
    const day = md === '02-29' ? '02-28' : md;
    if (`${y}-${day}` >= today) return `${y}-${day}`;
  }
}

export interface VenueOption {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

/** Venues from the site, from the ones added in the tool, and any an event names that neither knows. */
export function venueOptions(
  sites: { id: string; name: string; lat: number; lng: number }[],
  added: { id: string; name: string; lat: number; lng: number }[],
  events: EventRow[]
): VenueOption[] {
  const known = new Map<string, VenueOption>();
  for (const v of [...sites, ...added]) known.set(v.id, { id: v.id, name: v.name, lat: v.lat, lng: v.lng });
  for (const e of events)
    if (e.site_id && !known.has(e.site_id))
      known.set(e.site_id, { id: e.site_id, name: e.site_id, lat: null, lng: null });
  return [...known.values()].sort((a, b) => a.name.localeCompare(b.name));
}

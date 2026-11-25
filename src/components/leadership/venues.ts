// Venues for staffing: the site's own, the ones added in the tool, and any an event names
// that neither knows.

import type { EventRow } from './model';

export interface VenueOption {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

/** "the-y-at-watson-woods" read as words, for a venue only an event knows by its id. */
const fromSlug = (id: string) =>
  id
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');

/** Sorts "The Y at Watson Woods" under W, not T. */
const sortKey = (name: string) => name.replace(/^the\s+/i, '');

export function venueOptions(
  sites: { id: string; name: string; lat: number; lng: number }[],
  added: { id: string; name: string; lat: number; lng: number }[],
  events: EventRow[]
): VenueOption[] {
  const known = new Map<string, VenueOption>();
  for (const v of [...sites, ...added]) known.set(v.id, { id: v.id, name: v.name, lat: v.lat, lng: v.lng });
  for (const e of events)
    if (e.site_id && !known.has(e.site_id))
      known.set(e.site_id, { id: e.site_id, name: fromSlug(e.site_id), lat: null, lng: null });
  return [...known.values()].sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
}

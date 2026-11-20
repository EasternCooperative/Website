// Venues for staffing: the site's own, the ones added in the tool, and any an event names
// that neither knows.

import type { EventRow } from './model';

export interface VenueOption {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

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

// Venues added in the tool. The postal code is looked up once, here, so the browser never
// needs a postal-code database.

import { ValidationError } from './leadership.js';

const slugOf = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/** Looks up a US postal code's city, state, and center point. Returns null if it is not found. */
export async function lookupPostalCode(zip, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`https://api.zippopotam.us/us/${zip}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const place = (await res.json()).places?.[0];
    const lat = Number(place?.latitude);
    const lng = Number(place?.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng)
      ? { city: place['place name'] ?? null, state: place['state abbreviation'] ?? null, zip, lat, lng, address: null }
      : null;
  } catch {
    return null;
  }
}

/** Finds a US street address with the Census geocoder, which needs no key. Returns null if there is no match. */
export async function lookupAddress(address, fetchImpl = fetch) {
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(address)}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const hit = (await res.json()).result?.addressMatches?.[0];
    const lat = Number(hit?.coordinates?.y);
    const lng = Number(hit?.coordinates?.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const c = hit.addressComponents ?? {};
    return {
      city: c.city ?? null,
      state: c.state ?? null,
      zip: c.zip ?? '',
      lat,
      lng,
      address: hit.matchedAddress ?? null,
    };
  } catch {
    return null;
  }
}

/** Adds a venue from a name and an address (or just a postal code). Returns its id. */
export async function createVenue(db, body, actor, fetchImpl = fetch) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) throw new ValidationError('name is required, up to 120 characters');
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const zip = typeof body.postal_code === 'string' ? body.postal_code.trim().match(/^\d{5}/)?.[0] : null;
  if (!address && !zip) throw new ValidationError('address is required, for example 609 Geigel Hill Rd, Ottsville, PA');
  if (address.length > 200) throw new ValidationError('address is too long');
  const place =
    (address && (await lookupAddress(address, fetchImpl))) ||
    // A street the geocoder does not know can still be placed by a postal code in the address.
    (await lookupPostalCode(zip ?? address.match(/\b\d{5}\b/)?.[0] ?? '', fetchImpl));
  if (!place) throw new ValidationError('That address could not be found. Check it, or include the city and state.');
  const base = slugOf(name) || 'venue';
  let id = base;
  for (let n = 2; ; n++) {
    const taken = (await db.prepare('SELECT 1 AS x FROM venue WHERE id = ?').bind(id).all()).results.length > 0;
    if (!taken) break;
    id = `${base}-${n}`;
  }
  await db
    .prepare(
      'INSERT INTO venue (id, name, city, state, postal_code, address, lat, lng, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(id, name, place.city, place.state, place.zip, place.address, place.lat, place.lng, actor)
    .run();
  return id;
}

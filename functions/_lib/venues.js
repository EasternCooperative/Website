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
      ? { city: place['place name'] ?? null, state: place['state abbreviation'] ?? null, lat, lng }
      : null;
  } catch {
    return null;
  }
}

/** Adds a venue from a name and a postal code. Returns its id. */
export async function createVenue(db, body, actor, fetchImpl = fetch) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) throw new ValidationError('name is required, up to 120 characters');
  const zip = typeof body.postal_code === 'string' ? body.postal_code.trim().match(/^\d{5}/)?.[0] : null;
  if (!zip) throw new ValidationError('postal_code must be a five-digit US postal code');
  const place = await lookupPostalCode(zip, fetchImpl);
  if (!place) throw new ValidationError('That postal code could not be found. Check it and try again.');
  const base = slugOf(name) || 'venue';
  let id = base;
  for (let n = 2; ; n++) {
    const taken = (await db.prepare('SELECT 1 AS x FROM venue WHERE id = ?').bind(id).all()).results.length > 0;
    if (!taken) break;
    id = `${base}-${n}`;
  }
  await db
    .prepare(
      'INSERT INTO venue (id, name, city, state, postal_code, lat, lng, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(id, name, place.city, place.state, zip, place.lat, place.lng, actor)
    .run();
  return id;
}

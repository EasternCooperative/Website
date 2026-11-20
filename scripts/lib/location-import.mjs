// Where people live, at the level of a postal code, from the addresses on registrations,
// the membership form, the donation form, and Zeffy. Only city, state, the postal code, and
// that code's center point are kept: never a street address. Only people already in the
// database are given a location, so nothing here adds anyone. Pure: rows in, SQL out.

import zipcodes from 'zipcodes';
import { norm, sql } from './leadership-history.mjs';
import { extractEntry } from './cognito-extract.mjs';
import { identitiesFrom, resolveIdentities } from './cognito-import.mjs';

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** A US postal code's city, state, and center point, or null. */
export function placeOf(zip) {
  const five = text(String(zip ?? '')).match(/^\d{5}/)?.[0];
  const hit = five ? zipcodes.lookup(five) : null;
  return hit && hit.country === 'US'
    ? { postal_code: five, city: hit.city, state: hit.state, lat: hit.latitude, lng: hit.longitude }
    : null;
}

/** Who a Cognito entry's address belongs to: the registrant, the primary member, or the donor. */
function owner(e, formId) {
  if (String(formId) === '16')
    return {
      first: text(e.PrimaryMemberFirstName),
      last: text(e.PrimaryMemberLastName),
      email: text(e.Email).toLowerCase() || null,
    };
  if (String(formId) === '24')
    return {
      first: text(e.DonorName?.First ?? e.DonorName?.FirstAndLast),
      last: text(e.DonorName?.Last),
      email: text(e.DonorEmail).toLowerCase() || null,
    };
  const a = extractEntry(e, { key: 'unused' }).adults?.[0];
  return a ? { first: a.first, last: a.last, email: a.email } : null;
}

/** One row per Cognito entry that has a US postal code and someone to attach it to. */
export function cognitoLocationRows(entries, formId) {
  const out = [];
  for (const e of entries) {
    if (e?.Entry?.Status === 'Incomplete') continue;
    const place = placeOf(e?.Address?.PostalCode);
    const who = place && owner(e, formId);
    if (!who || !(who.first || who.last)) continue;
    out.push({
      ...who,
      ...place,
      source: 'cognito',
      asOf: String(e.Entry?.DateSubmitted ?? e.Entry?.DateCreated ?? '').slice(0, 10) || '0000-00-00',
    });
  }
  return out;
}

/** One row per Zeffy payment with a US postal code. `header` is the first row of the export. */
export function zeffyLocationRows(header, rows) {
  const col = (name, nth = 0) => {
    let seen = -1;
    return header.findIndex((h) => h === name && ++seen === nth);
  };
  const c = {
    first: col('First Name'),
    last: col('Last Name'),
    email: col('Email', 0),
    zip: col('Postal Code'),
    country: col('Country'),
    date: col('Payment Date (America/Los_Angeles)'),
    status: col('Payment Status'),
  };
  const out = [];
  for (const r of rows) {
    if (c.status >= 0 && r[c.status] !== 'Succeeded') continue;
    const place = placeOf(r[c.zip]);
    const first = text(String(r[c.first] ?? ''));
    const last = text(String(r[c.last] ?? ''));
    if (!place || (!first && !last)) continue;
    if (c.country >= 0 && r[c.country] && !/^(us|usa|united states)/i.test(String(r[c.country]))) continue;
    const m = String(r[c.date] ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    out.push({
      first,
      last,
      email: text(String(r[c.email] ?? '')).toLowerCase() || null,
      ...place,
      source: 'zeffy',
      asOf: m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '0000-00-00',
    });
  }
  return out;
}

/**
 * Matches each row to a person already in the database, and writes the newest location per
 * person. Anyone who would need a decision, or who is not in the database, is left out and
 * counted. People who already have a newer location keep it.
 * @param people [{ id, name, emails: string[] }]
 */
export function locationStatements({ rows, people, overrides = {} }) {
  const { identities, sharedEmails } = identitiesFrom(rows);
  const { resolved, review, alias } = resolveIdentities(identities, people, { overrides });
  const byPerson = new Map();
  for (const r of rows) {
    const key = norm(`${r.first} ${r.last}`.replace(/\s+/g, ' ').trim());
    const hit = resolved.find((x) => x.id.key === (alias.get(key) ?? key));
    if (!hit?.person) continue;
    const best = byPerson.get(hit.person.id);
    if (!best || r.asOf > best.asOf) byPerson.set(hit.person.id, r);
  }
  const statements = [...byPerson].map(
    ([id, r]) => `INSERT INTO person_location (person_id, city, state, postal_code, lat, lng, source, as_of)
 SELECT ${Number(id)}, ${sql(r.city)}, ${sql(r.state)}, ${sql(r.postal_code)}, ${Number(r.lat)}, ${Number(r.lng)}, ${sql(r.source)}, ${sql(r.asOf)}
 WHERE EXISTS (SELECT 1 FROM person WHERE id = ${Number(id)} AND deleted_at IS NULL AND erased_at IS NULL)
 ON CONFLICT(person_id) DO UPDATE SET city = excluded.city, state = excluded.state, postal_code = excluded.postal_code,
   lat = excluded.lat, lng = excluded.lng, source = excluded.source, as_of = excluded.as_of,
   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE excluded.as_of > COALESCE(person_location.as_of, '');`
  );
  return {
    statements,
    counts: {
      rows: rows.length,
      people: identities.length,
      located: byPerson.size,
      needDecision: review.length,
      notInDatabase: resolved.filter((r) => !r.person).length,
      sharedEmails: sharedEmails.size,
    },
  };
}

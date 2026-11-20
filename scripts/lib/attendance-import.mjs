// Loads real attendance from event attendee lists (Drive sheets saved as CSV). A list is
// the people who registered, with a mark in one column for those who did not come, so
// everyone else counts as attended. Only name, email, and that mark are read: phone numbers
// and notes are ignored. Pure: rows in, SQL out. Safe to run twice.

import { createHash } from 'node:crypto';
import { norm, sql } from './leadership-history.mjs';
import { importStatements, lookup } from './cognito-import.mjs';

const BY = "'script:cognito-import'";
const refFor = (first, last) =>
  createHash('sha256')
    .update(norm(`${first} ${last}`))
    .digest('hex')
    .slice(0, 16);

/**
 * @param {string[][]} table parsed CSV, header first
 * @param {string} eventSlug the site event id the list belongs to
 */
export function attendeeRows(table, eventSlug) {
  const [head, ...body] = table;
  const col = (re) => head.findIndex((h) => re.test(h));
  const [f, l, e, no] = [col(/^first name/i), col(/^last name/i), col(/^email/i), col(/did not attend/i)];
  if (f < 0 || l < 0 || no < 0) throw new Error('expected First Name, Last Name, and a "did not attend" column');
  const rows = [];
  for (const r of body) {
    const first = (r[f] ?? '').trim();
    const last = (r[l] ?? '').trim();
    if (!first && !last) continue;
    const email = (r[e] ?? '').trim().toLowerCase();
    rows.push({
      first,
      last,
      email: email.includes('@') ? email : null,
      attended: (r[no] ?? '').trim() ? 0 : 1,
      eventSlug,
    });
  }
  return rows;
}

/** New people first (through importStatements), then one registration per person and event. */
export function attendanceStatements({ rows, resolved, alias = new Map(), sharedEmails, newStatus }) {
  const out = importStatements({ resolved, entries: [], eventOf: () => null, sharedEmails, newStatus, alias });
  const who = new Map(resolved.filter((r) => r.how !== 'skipped').map((r) => [r.id.key, r]));
  const event = (slug) => `(SELECT id FROM event WHERE site_event_id = ${sql(slug)} AND deleted_at IS NULL)`;
  for (const g of rows) {
    const own = norm(`${g.first} ${g.last}`.replace(/\s+/g, ' ').trim());
    const r = who.get(alias.get(own) ?? own);
    if (!r) continue;
    const ref = refFor(g.first, g.last);
    out.push(`INSERT INTO registration (person_id, event_id, source, entry_ref, attendee_ref, status, attended, created_by, updated_by)
 SELECT ${lookup(r)}, ${event(g.eventSlug)}, 'attendee-list', ${sql(g.eventSlug)}, ${sql(ref)}, 'registered', ${g.attended}, ${BY}, ${BY}
 WHERE ${lookup(r)} IS NOT NULL AND ${event(g.eventSlug)} IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM registration WHERE person_id = ${lookup(r)} AND event_id = ${event(g.eventSlug)} AND deleted_at IS NULL);`);
    // A registration from another source for the same person and event learns the real outcome.
    out.push(`UPDATE registration SET attended = ${g.attended}, updated_by = ${BY}
 WHERE person_id = ${lookup(r)} AND event_id = ${event(g.eventSlug)} AND deleted_at IS NULL AND status != 'cancelled'
   AND (attended IS NULL OR attended != ${g.attended});`);
  }
  return out;
}

// Registrations from Zeffy ticket purchases: one per payer per event. Zeffy has no payment
// id, so a payment is the date, time, and payer, hashed so no name is stored. Money is not
// read here. Pure: rows in, SQL out. Safe to run twice.

import { norm, sql } from './leadership-history.mjs';
import { importStatements, lookup } from './cognito-import.mjs';
import { paymentRef } from './donation-import.mjs';
import { isoDate } from './giving-bands.mjs';

const BY = "'script:cognito-import'";

// Ticket campaigns that become events. `create` events do not exist yet and are added;
// the 2026 Philly Fun Days are left out because their attendee lists already cover them.
export const TICKET_EVENTS = {
  'ECRS Fun Day Philly- Sunday May 18, 2025': { name: 'Fun Day in Philly (May 18)', year: 2025, create: true },
  'ECRS Fun Day in Philly - Saturday, October 4, 2025': {
    name: 'Fun Day in Philly (October 4)',
    year: 2025,
    create: true,
  },
  'ECRS Fun Day in Philly 2024': { name: 'Fun Day in Philly', year: 2024, create: true },
  'ECRS Fun Day in Wilmington': { name: 'ECRS Fun Day in Wilmington', year: 2026, create: false },
};

/** One row per payer per event from a Zeffy "All payments" export (header first row). */
export function ticketRegistrations(header, rows) {
  const col = (name, nth = 0) => {
    let seen = -1;
    return header.findIndex((h) => h === name && ++seen === nth);
  };
  const c = {
    status: col('Payment Status'),
    campaign: col('Campaign Title'),
    first: col('First Name'),
    last: col('Last Name'),
    email: col('Email', 0),
    formEmail: col('Email', 1),
    date: col('Payment Date (America/Los_Angeles)'),
    time: col('Payment Time (America/Los_Angeles)'),
  };
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const event = TICKET_EVENTS[r[c.campaign]];
    if (!event || r[c.status] !== 'Succeeded') continue;
    const first = String(r[c.first] ?? '').trim();
    const last = String(r[c.last] ?? '').trim();
    if (!first && !last) continue;
    const ref = paymentRef(`${r[c.date]}|${r[c.time]}|${first} ${last}`);
    if (seen.has(`${ref}|${event.name}|${event.year}`)) continue; // a payment has one row per ticket line
    seen.add(`${ref}|${event.name}|${event.year}`);
    const email = r[c.email] ?? r[c.formEmail] ?? null;
    out.push({
      first,
      last,
      email: email ? String(email).trim().toLowerCase() : null,
      event,
      date: isoDate(r[c.date]),
      ref,
    });
  }
  return out;
}

const eventId = (e) => `(SELECT id FROM event WHERE name = ${sql(e.name)} AND year = ${e.year} AND deleted_at IS NULL)`;

export function ticketStatements({ rows, resolved, alias = new Map(), sharedEmails, newStatus }) {
  const out = [];
  const made = new Set();
  for (const g of rows) {
    const e = g.event;
    if (e.create && !made.has(e.name + e.year)) {
      made.add(e.name + e.year);
      out.push(`INSERT INTO event (name, event_type, year, created_by, updated_by)
 SELECT ${sql(e.name)}, 'one_day', ${e.year}, ${BY}, ${BY}
 WHERE NOT EXISTS (SELECT 1 FROM event WHERE name = ${sql(e.name)} AND year = ${e.year} AND deleted_at IS NULL);`);
    }
  }
  out.push(...importStatements({ resolved, entries: [], eventOf: () => null, sharedEmails, newStatus, alias }));
  const who = new Map(resolved.filter((r) => r.how !== 'skipped').map((r) => [r.id.key, r]));
  for (const g of rows) {
    const own = norm(`${g.first} ${g.last}`.replace(/\s+/g, ' ').trim());
    const r = who.get(alias.get(own) ?? own);
    if (!r) continue;
    out.push(`INSERT INTO registration (person_id, event_id, source, entry_ref, attendee_ref, registered_at, status, created_by, updated_by)
 SELECT ${lookup(r)}, ${eventId(g.event)}, 'zeffy', ${sql(g.ref)}, '', ${sql(g.date)}, 'registered', ${BY}, ${BY}
 WHERE ${lookup(r)} IS NOT NULL AND ${eventId(g.event)} IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM registration WHERE source = 'zeffy' AND entry_ref = ${sql(g.ref)} AND attendee_ref = '' AND deleted_at IS NULL);`);
  }
  return out;
}

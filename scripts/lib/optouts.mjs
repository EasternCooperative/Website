// Turns a Mailchimp "unsubscribed" export into do-not-contact marks, so the tool never
// suggests contacting someone who opted out. Pure: rows in, SQL and counts out.
//
// Safety first: if an unsubscribed address is shared (a household), everyone who uses it
// is marked, because an email to that address reaches them anyway. A name with no address
// match is matched only on an exact name.

import { norm, sql } from './leadership-history.mjs';

const BY = "'script:mailchimp-optouts'";
const NOTE = 'Unsubscribed from the newsletter list (Mailchimp)';

/**
 * @param rows   [{ email, first, last }] from the unsubscribed export
 * @param people [{ id, name, emails: string[] }] already in the database
 */
export function optoutStatements(rows, people) {
  const byEmail = new Map();
  const byName = new Map();
  for (const p of people) {
    for (const e of p.emails) byEmail.set(e, [...(byEmail.get(e) ?? []), p]);
    byName.set(norm(p.name), [...(byName.get(norm(p.name)) ?? []), p]);
  }
  const marked = new Map(); // person id -> why
  let sharedAddresses = 0;
  let unmatched = 0;
  for (const r of rows) {
    const email = String(r.email ?? '')
      .trim()
      .toLowerCase();
    const hits = email ? (byEmail.get(email) ?? []) : [];
    if (hits.length) {
      if (hits.length > 1) sharedAddresses++;
      for (const p of hits) marked.set(p.id, marked.get(p.id) ?? 'email');
      continue;
    }
    const named = byName.get(norm(`${r.first ?? ''} ${r.last ?? ''}`)) ?? [];
    if (named.length === 1) marked.set(named[0].id, marked.get(named[0].id) ?? 'name');
    else unmatched++;
  }
  const statements = [...marked.keys()].map(
    (id) => `INSERT INTO outreach (person_id, goal, status, note, created_by, updated_by)
 SELECT ${Number(id)}, 'invite_back', 'do_not_contact', ${sql(NOTE)}, ${BY}, ${BY}
 WHERE EXISTS (SELECT 1 FROM person WHERE id = ${Number(id)} AND deleted_at IS NULL AND erased_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM outreach WHERE person_id = ${Number(id)} AND status = 'do_not_contact' AND deleted_at IS NULL);`
  );
  return {
    statements,
    marked: marked.size,
    byEmail: [...marked.values()].filter((v) => v === 'email').length,
    byName: [...marked.values()].filter((v) => v === 'name').length,
    sharedAddresses,
    unmatched,
  };
}

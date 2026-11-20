// Loads memberships from the Cognito membership form (form 16). People are matched with
// the same rules as registrations (see cognito-import.mjs); anyone new is added. Pure:
// entries in, rows and SQL out. Safe to run twice. No dues amounts are read.

import { sql } from './leadership-history.mjs';
import { importStatements, lookup } from './cognito-import.mjs';
import { norm } from './leadership-history.mjs';

const BY = "'script:cognito-import'";
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
const emailOf = (v) => text(v).toLowerCase() || null;

/**
 * One row per member per entry: the primary member and any household members named on
 * it. Counts only paid, completed entries; the rest are tallied so nothing vanishes
 * silently. The year is the year it was submitted.
 */
export function membershipRows(entries) {
  const rows = [];
  const skipped = { incomplete: 0, unpaid: 0, refunded: 0, noDate: 0 };
  for (const e of entries) {
    const status = e?.Entry?.Status;
    const pay = e?.Order?.PaymentStatus ?? e?.Entry?.Order?.PaymentStatus;
    if (status === 'Incomplete') skipped.incomplete++;
    else if (pay === 'Refunded') skipped.refunded++;
    else if (pay !== 'Paid') skipped.unpaid++;
    else {
      const year = Number(String(e.Entry?.DateSubmitted ?? '').slice(0, 4));
      if (!year) {
        skipped.noDate++;
        continue;
      }
      const kind = /^lifetime/i.test(text(e.TypeOfPrimaryMembership)) ? 'life' : 'annual';
      const ref = String(e.Id ?? '');
      const people = [
        { first: text(e.PrimaryMemberFirstName), last: text(e.PrimaryMemberLastName), email: emailOf(e.Email) },
        ...(e.AdditionalHouseholdMembers ?? []).map((m) => ({
          first: text(m.FirstName),
          last: text(m.LastName),
          email: emailOf(m.Email),
        })),
      ];
      people.forEach((p, i) => {
        if (p.first || p.last) rows.push({ ...p, year, kind, sourceRef: `${ref}/${i}` });
      });
    }
  }
  return { rows, skipped };
}

/**
 * Statements for new people, then one membership per member and year (annual, ending
 * December 31) or one lifetime membership. Skips a membership the person already has.
 */
export function membershipStatements({ rows, resolved, alias = new Map(), sharedEmails, newStatus }) {
  const out = importStatements({ resolved, entries: [], eventOf: () => null, sharedEmails, newStatus, alias });
  const who = new Map(resolved.filter((r) => r.how !== 'skipped').map((r) => [r.id.key, r]));
  for (const m of rows) {
    const own = norm(`${m.first} ${m.last}`.replace(/\s+/g, ' ').trim());
    const r = who.get(alias.get(own) ?? own);
    if (!r) continue;
    const ends = m.kind === 'life' ? null : `${m.year}-12-31`;
    out.push(`INSERT INTO membership (person_id, kind, starts_on, ends_on, source, source_ref, created_by, updated_by)
 SELECT ${lookup(r)}, ${sql(m.kind)}, ${sql(`${m.year}-01-01`)}, ${sql(ends)}, 'cognito-membership', ${sql(m.sourceRef)}, ${BY}, ${BY}
 WHERE ${lookup(r)} IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM membership WHERE person_id = ${lookup(r)} AND kind = ${sql(m.kind)}
     AND deleted_at IS NULL AND ${m.kind === 'life' ? '1 = 1' : `ends_on = ${sql(ends)}`});`);
  }
  return out;
}

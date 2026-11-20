// Loads gifts: from Zeffy payments and the Cognito donation form. People are matched with
// the same rules as registrations (see cognito-import.mjs), and anyone new to the database
// is added. Pure: rows in, SQL out. Safe to run twice.
//
// Money lives only in `donation`, which only the finance level can read. Nothing here
// prints an amount.

import { createHash } from 'node:crypto';
import { norm, sql } from './leadership-history.mjs';
import { importStatements, lookup } from './cognito-import.mjs';

const BY = "'script:cognito-import'"; // matches the people this import adds (see lookup)

/** A short, stable reference for a payment that has no id, with no name inside it. */
export const paymentRef = (payment) => createHash('sha256').update(String(payment)).digest('hex').slice(0, 20);

// A column that is never NULL: an empty string stays an empty string (sql() would make it NULL).
const quote = (v) => `'${String(v ?? '').replaceAll("'", "''")}'`;
const isoDay = (text) => (text ? String(text).slice(0, 10) : null);

/** Cognito donation-form entries (form 24): paid and complete only, net of refunds. */
export function cognitoGiftRows(entries) {
  const out = [];
  for (const e of entries) {
    if (e?.Entry?.Status === 'Incomplete' || e?.Order?.PaymentStatus !== 'Paid') continue;
    let dollars = Number(e.Order.AmountPaid ?? e.Order.OrderAmount ?? e.AmountToDonate);
    if (!Number.isFinite(dollars)) continue;
    dollars -= Number(e.Order.RefundAmount) || 0;
    const first = e.DonorName?.First ?? e.DonorName?.FirstAndLast ?? '';
    const last = e.DonorName?.Last ?? '';
    const email = typeof e.DonorEmail === 'string' && e.DonorEmail.trim() ? e.DonorEmail.trim().toLowerCase() : null;
    const date = isoDay(e.Order.PaymentDate ?? e.Order.Date ?? e.Entry?.DateSubmitted);
    if (!(dollars > 0) || !date || (!email && !`${first}${last}`.trim())) continue;
    out.push({
      first: String(first),
      last: String(last),
      email,
      cents: Math.round(dollars * 100),
      date,
      source: 'cognito',
      sourceRef: String(e.Id ?? ''),
      lineRef: '',
      campaign: 'Donation form',
      recurring: 0,
    });
  }
  return out;
}

/** Zeffy rows from zeffyGiftRows, in the same shape. */
export function zeffyDonationRows(rows) {
  return rows
    .filter((g) => g.date)
    .map((g) => ({
      first: g.first,
      last: g.last,
      email: g.email,
      cents: g.cents,
      date: g.date,
      source: 'zeffy',
      sourceRef: paymentRef(g.payment),
      lineRef: g.lineRef,
      campaign: g.campaign,
      recurring: g.recurring,
    }));
}

/**
 * Statements for new people and their addresses (through importStatements, with no
 * registrations), then one donation per gift for anyone who resolved to a person.
 * @param rows gifts from cognitoGiftRows and zeffyDonationRows
 * @param {{ resolved: any[], alias?: Map<string, string>, sharedEmails: Set<string>, newStatus: string }} people from resolveIdentities
 */
export function donationStatements({ rows, resolved, alias = new Map(), sharedEmails, newStatus }) {
  const out = importStatements({ resolved, entries: [], eventOf: () => null, sharedEmails, newStatus, alias });
  const who = new Map(resolved.filter((r) => r.how !== 'skipped').map((r) => [r.id.key, r]));
  for (const g of rows) {
    const own = norm(`${g.first} ${g.last}`.replace(/\s+/g, ' ').trim());
    const r = who.get(alias.get(own) ?? own);
    if (!r) continue;
    out.push(`INSERT INTO donation (person_id, source, source_ref, line_ref, amount_cents, donated_at, campaign, kind, recurring, created_by, updated_by)
 SELECT ${lookup(r)}, ${sql(g.source)}, ${sql(g.sourceRef)}, ${quote(g.lineRef)}, ${Number(g.cents)}, ${sql(g.date)}, ${sql(g.campaign)}, 'gift', ${g.recurring ? 1 : 0}, ${BY}, ${BY}
 WHERE ${lookup(r)} IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM donation WHERE source = ${sql(g.source)} AND source_ref = ${sql(g.sourceRef)} AND line_ref = ${quote(g.lineRef)} AND deleted_at IS NULL);`);
  }
  return out;
}

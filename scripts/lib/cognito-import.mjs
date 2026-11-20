// Matches registration attendees to people, and writes the SQL that loads them. Pure:
// data in, statements out. Every statement checks before it writes, so it is safe to run
// twice. Nothing here guesses between two people: ambiguous cases go to a review list.

import { levenshtein, norm, sql } from './leadership-history.mjs';

const BY = "'script:cognito-import'";
const words = (n) => norm(n).split(' ').filter(Boolean);
export const fullName = (first, last) => `${first ?? ''} ${last ?? ''}`.replace(/\s+/g, ' ').trim();

/** Same name, or the same last name with a first name that is equal, an initial, or a prefix. */
export function compatibleNames(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.length || !B.length) return false;
  if (A.join(' ') === B.join(' ')) return true;
  if (A.at(-1) !== B.at(-1)) return false;
  const [fa, fb] = [A[0], B[0]];
  return (
    fa === fb || (fa[0] === fb[0] && (fa.length === 1 || fb.length === 1 || fa.startsWith(fb) || fb.startsWith(fa)))
  );
}

const near = (a, b) => {
  const [x, y] = [words(a).join(' '), words(b).join(' ')];
  return x.length > 6 && levenshtein(x, y) <= 2;
};

/**
 * Groups attendee rows into identities by normalized name, collecting their emails.
 * An email seen under two names that are not compatible is marked shared.
 */
export function identitiesFrom(rows) {
  const ids = new Map();
  for (const r of rows) {
    const name = fullName(r.first, r.last);
    const key = norm(name);
    if (!key) continue;
    const id = ids.get(key) ?? { key, name, emails: new Set(), rows: 0, spellings: new Map() };
    if (r.email) id.emails.add(r.email);
    id.rows++;
    id.spellings.set(name, (id.spellings.get(name) ?? 0) + 1);
    ids.set(key, id);
  }
  for (const id of ids.values())
    id.name = [...id.spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const owners = new Map(); // email -> identities using it
  for (const id of ids.values()) for (const e of id.emails) owners.set(e, [...(owners.get(e) ?? []), id]);
  const sharedEmails = new Set();
  for (const [email, list] of owners) {
    if (list.some((a, i) => list.slice(i + 1).some((b) => !compatibleNames(a.name, b.name)))) sharedEmails.add(email);
  }
  return { identities: [...ids.values()], sharedEmails };
}

/**
 * Decides who each identity is.
 * @param identities from identitiesFrom
 * @param people     [{ id, name, emails: string[] }] already in the database
 * @param overrides  { rawName: canonicalName } private nickname and former-name map
 * @param decisions  Map(norm name -> 'new' | 'skip' | 'match:<id or exact name>') from a reviewed file
 */
/** One cell of the reviewed file: new, skip, match:<id or name>, or as:<another name>. Anything else is ignored. */
export function parseDecision(text) {
  const t = String(text ?? '').trim();
  if (/^(new|skip)$/i.test(t)) return t.toLowerCase();
  const m = t.match(/^(match|as)\s*:\s*(.+)$/i);
  return m ? `${m[1].toLowerCase()}:${m[2].trim()}` : null;
}

/**
 * A reviewed decision "as:<name>" says one spelling is the same person as another name in
 * this import. Folds the first into the second and remembers the link, so registrations
 * under either spelling land on one person.
 */
export function foldIdentities(identities, decisions) {
  const byKey = new Map(identities.map((i) => [i.key, i]));
  const alias = new Map();
  const dangling = [];
  for (const id of identities) {
    const d = decisions.get(id.key);
    if (!d?.startsWith('as:')) continue;
    const target = byKey.get(norm(d.slice(3)));
    if (!target || target.key === id.key || decisions.get(target.key)?.startsWith('as:')) {
      dangling.push(id);
      continue;
    }
    alias.set(id.key, target.key);
    id.emails.forEach((e) => target.emails.add(e));
    target.rows += id.rows;
  }
  return { kept: identities.filter((i) => !alias.has(i.key) && !dangling.includes(i)), alias, dangling };
}

export function resolveIdentities(allIdentities, people, { overrides = {}, decisions = new Map() } = {}) {
  const { kept: identities, alias, dangling } = foldIdentities(allIdentities, decisions);
  const byName = new Map();
  for (const p of people) byName.set(norm(p.name), [...(byName.get(norm(p.name)) ?? []), p]);
  const byId = new Map(people.map((p) => [String(p.id), p]));
  const override = new Map(Object.entries(overrides).map(([k, v]) => [norm(k), v]));
  const resolved = [];
  const review = dangling.map((id) => ({
    id,
    reason: `the reviewed decision "${decisions.get(id.key)}" names no one in this import`,
    candidates: [],
  }));

  for (const id of identities) {
    const decided = decisions.get(id.key);
    if (decided === 'skip') {
      resolved.push({ id, how: 'skipped', person: null });
      continue;
    }
    if (decided === 'new') {
      resolved.push({ id, how: 'new', person: null });
      continue;
    }
    if (decided?.startsWith('match:')) {
      const ref = decided.slice(6).trim();
      const p = byId.get(ref) ?? byName.get(norm(ref))?.[0];
      if (p) {
        resolved.push({ id, how: 'decided', person: p });
      } else {
        review.push({
          id,
          reason: `the reviewed decision "${decided}" matches no one in the database`,
          candidates: [],
        });
      }
      continue;
    }

    const exact = byName.get(id.key) ?? [];
    if (exact.length === 1) {
      resolved.push({ id, how: 'name', person: exact[0] });
      continue;
    }
    if (exact.length > 1) {
      review.push({ id, reason: 'two people in the database share this name', candidates: exact });
      continue;
    }
    const aliased = override.has(id.key) ? byName.get(norm(override.get(id.key))) : null;
    if (aliased?.length === 1) {
      resolved.push({ id, how: 'override', person: aliased[0] });
      continue;
    }
    const byEmail = people.filter((p) => p.emails.some((e) => id.emails.has(e)) && compatibleNames(p.name, id.name));
    if (byEmail.length === 1) {
      resolved.push({ id, how: 'email', person: byEmail[0] });
      continue;
    }
    const close = people.filter((p) => compatibleNames(p.name, id.name) || near(p.name, id.name));
    const sameEmailOtherName = people.filter((p) => p.emails.some((e) => id.emails.has(e)));
    const candidates = [...new Set([...close, ...sameEmailOtherName])];
    if (candidates.length) {
      review.push({
        id,
        reason: close.length
          ? 'a similar name is already in the database'
          : 'this email belongs to someone with a different name',
        candidates,
      });
      continue;
    }
    resolved.push({ id, how: 'new', person: null });
  }

  // New identities that look like each other are a review too: one person under two spellings.
  const fresh = resolved.filter((r) => r.how === 'new' && !decisions.has(r.id.key));
  for (let i = 0; i < fresh.length; i++) {
    for (let j = i + 1; j < fresh.length; j++) {
      if (compatibleNames(fresh[i].id.name, fresh[j].id.name) || near(fresh[i].id.name, fresh[j].id.name)) {
        for (const r of [fresh[i], fresh[j]]) {
          if (!review.some((x) => x.id.key === r.id.key)) {
            review.push({ id: r.id, reason: 'looks like another new person in this import', candidates: [] });
          }
        }
      }
    }
  }
  const reviewKeys = new Set(review.map((r) => r.id.key));
  return { resolved: resolved.filter((r) => !reviewKeys.has(r.id.key)), review, alias };
}

/** New people whose names would collide in a lookup by name. The SQL must refuse these. */
export function newNameCollisions(resolved) {
  const seen = new Map();
  for (const r of resolved.filter((x) => x.how === 'new')) seen.set(r.id.key, (seen.get(r.id.key) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
}

export const lookup = (r) =>
  r.person
    ? `${Number(r.person.id)}`
    : `(SELECT id FROM person WHERE lower(name) = lower(${sql(r.id.name)}) AND created_by = ${BY} AND deleted_at IS NULL AND erased_at IS NULL)`;

export const statusFor = (payment, status) =>
  payment === 'Refunded' || status === 'Cancelled' ? 'cancelled' : 'registered';

/**
 * The statements for one import.
 * @param resolved  from resolveIdentities (people to load: matched or new)
 * @param entries   extracted entries (scripts/lib/cognito-extract.mjs) for confirmed forms only
 * @param eventOf   (formId) => event slug
 * @param sharedEmails Set of emails used by more than one person
 * @param newStatus status given to people who are new to the database
 * @param alias  Map(spelling -> the identity it was folded into), from resolveIdentities
 * @param children 'all' (default), 'none', or 'only': child tokens can be loaded separately, once the key is backed up
 */
export function importStatements({
  resolved,
  entries,
  eventOf,
  sharedEmails,
  newStatus,
  alias = new Map(),
  children = 'all',
}) {
  const out = [];
  const people = children !== 'only'; // 'only' writes just the child tokens, 'none' leaves them out
  const who = new Map(resolved.filter((r) => r.how !== 'skipped').map((r) => [r.id.key, r]));

  // People who are new.
  for (const r of people ? who.values() : []) {
    if (r.person) continue;
    const primary = [...r.id.emails].find((e) => !sharedEmails.has(e)) ?? null;
    out.push(`INSERT INTO person (name, email, status, mentor, created_by, updated_by)
 SELECT ${sql(r.id.name)}, ${sql(primary)}, ${sql(newStatus)}, 0, ${BY}, ${BY}
 WHERE NOT EXISTS (SELECT 1 FROM person WHERE lower(name) = lower(${sql(r.id.name)}) AND deleted_at IS NULL AND erased_at IS NULL);`);
  }

  // Their email addresses, and a missing email filled in for people already there.
  for (const r of people ? who.values() : []) {
    const first = [...r.id.emails].find((e) => !sharedEmails.has(e));
    if (r.person && first && !r.person.email) {
      out.push(
        `UPDATE person SET email = ${sql(first)}, updated_by = ${BY} WHERE id = ${Number(r.person.id)} AND email IS NULL;`
      );
    }
    for (const e of r.id.emails) {
      out.push(`INSERT INTO person_email (person_id, email_lower, is_primary, shared, created_by, updated_by)
 SELECT ${lookup(r)}, ${sql(e)}, ${e === first && !r.person ? 1 : 0}, ${sharedEmails.has(e) ? 1 : 0}, ${BY}, ${BY}
 WHERE ${lookup(r)} IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM person_email WHERE person_id = ${lookup(r)} AND email_lower = ${sql(e)} AND deleted_at IS NULL);`);
    }
  }

  // Registrations, child tokens, and membership purchases.
  for (const entry of entries) {
    const slug = eventOf(entry.formId);
    if (!slug) continue;
    const status = statusFor(entry.payment, entry.status);
    const event = `(SELECT id FROM event WHERE site_event_id = ${sql(slug)} AND deleted_at IS NULL)`;
    (people ? entry.adults : []).forEach((a, i) => {
      const own = norm(fullName(a.first, a.last));
      const r = who.get(alias.get(own) ?? own);
      if (!r) return;
      const ref = a.ref || `n${i}`;
      out.push(`INSERT INTO registration (person_id, event_id, source, entry_ref, attendee_ref, form_ref, registered_at, status, party_adults, party_children, created_by, updated_by)
 SELECT ${lookup(r)}, ${event}, 'cognito', ${sql(entry.entryRef)}, ${sql(ref)}, ${sql(entry.formId)}, ${sql(entry.submittedAt)}, ${sql(status)}, ${entry.partyAdults}, ${entry.partyChildren}, ${BY}, ${BY}
 WHERE ${lookup(r)} IS NOT NULL AND ${event} IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM registration WHERE source = 'cognito' AND entry_ref = ${sql(entry.entryRef)} AND attendee_ref = ${sql(ref)} AND deleted_at IS NULL);`);
      if (a.membershipYear && entry.payment === 'Paid') {
        // One row per person per year, however many events they bought it at.
        out.push(`INSERT INTO membership (person_id, kind, ends_on, source, source_ref, created_by, updated_by)
 SELECT ${lookup(r)}, 'annual', ${sql(`${a.membershipYear}-12-31`)}, 'cognito', ${sql(`${entry.entryRef}/${ref}`)}, ${BY}, ${BY}
 WHERE ${lookup(r)} IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM membership WHERE person_id = ${lookup(r)} AND kind = 'annual' AND ends_on = ${sql(`${a.membershipYear}-12-31`)} AND deleted_at IS NULL);`);
      }
    });
    if (status === 'registered' && children !== 'none') {
      for (const c of entry.children) {
        out.push(`INSERT INTO child_attendance (event_id, source, entry_ref, token, age_band, created_by, updated_by)
 SELECT ${event}, 'cognito', ${sql(entry.entryRef)}, ${sql(c.token)}, ${sql(c.band)}, ${BY}, ${BY}
 WHERE ${event} IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM child_attendance WHERE source = 'cognito' AND entry_ref = ${sql(entry.entryRef)} AND token = ${sql(c.token)} AND deleted_at IS NULL);`);
      }
    }
  }
  return out;
}

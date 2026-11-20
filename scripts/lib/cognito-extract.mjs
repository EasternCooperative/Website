// Turns a Cognito event-registration entry into the minimum we keep. This is an
// ALLOWLIST: only the fields named here are copied, so anything added to a form later
// (vaccination cards, dietary needs, phone, address, internal notes) is dropped by
// default. Children's names are hashed here, in memory, and never returned.

import { createHmac } from 'node:crypto';
import { norm } from './leadership-history.mjs';

/** A keyed hash of a child's normalized name. The key lives outside the database and the repo. */
export const childToken = (key, first, last) =>
  createHmac('sha256', key)
    .update(norm(`${first ?? ''} ${last ?? ''}`))
    .digest('hex');

/** under 6, 6 to 11, or 12 to 17: coarse on purpose. */
export function ageBand(age, group) {
  if (typeof age === 'number' && Number.isFinite(age)) {
    if (age < 6) return 'under 6';
    if (age < 12) return '6 to 11';
    if (age < 18) return '12 to 17';
    return null;
  }
  return { infant: 'under 6', child: '6 to 11', youth: '12 to 17' }[String(group ?? '').toLowerCase()] ?? null;
}

const ageOf = (a) => {
  const v = a.Age_Value ?? (typeof a.Age === 'number' ? a.Age : null);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** How each era marks a child: Under18 (2019), Adult=false (2021), AgeGroup (2023 on), or an age under 18. */
export function isChild(a) {
  const age = ageOf(a);
  const group = a.AgeGroup;
  return (
    a.Under18 === true ||
    a.Adult === false ||
    (typeof group === 'string' && group !== '' && group.toLowerCase() !== 'adult') ||
    (age !== null && age < 18)
  );
}

const MEMBERSHIP_FIELD = /^_(\d{4})ECRSMembership_QuantitySelected$/;
const email = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '') || null;

/**
 * One entry, reduced. Returns { skip: reason } for an entry we do not keep.
 * Attendees with no age and no email of their own (the 2018 forms have no age field)
 * are counted in the party but never made into people: they may be children.
 */
/**
 * @param {any} e a Cognito entry
 * @param {{ key: string }} options
 * @returns {any} the reduced entry, or { skip: reason }
 */
export function extractEntry(e, { key }) {
  if (e?.Entry?.Status === 'Incomplete') return { skip: 'incomplete' };
  // Most forms list attendees. The 2020 and 2021 virtual forms have one registrant at the
  // top level, and the 2021 family form lists a FamilyGroup.
  const listed = e.AttendeeInformation ?? e.Attendees ?? e.FamilyGroup;
  const list =
    listed ?? (e.Name?.FirstAndLast || e.Name?.First ? [{ Id: '', Name: e.Name, Email: e.Email, Adult: true }] : []);
  const adults = [];
  const children = [];
  let possibleChildren = 0;
  let noName = 0;
  for (const a of list) {
    const first = a.Name?.First ?? null;
    const last = a.Name?.Last ?? null;
    const full = a.Name?.FirstAndLast ?? [first, last].filter(Boolean).join(' ');
    if (!full) {
      noName++;
      continue;
    }
    if (isChild(a)) {
      children.push({ token: childToken(key, first ?? full, last ?? ''), band: ageBand(ageOf(a), a.AgeGroup) });
      continue;
    }
    const mail = email(a.Email);
    const age = ageOf(a);
    const sure = age !== null || a.Adult === true || String(a.AgeGroup ?? '').toLowerCase() === 'adult';
    if (!sure && !mail) {
      possibleChildren++;
      continue;
    }
    const membershipYear = Object.entries(a).reduce((y, [k, v]) => {
      const m = k.match(MEMBERSHIP_FIELD);
      return m && Number(v) > 0 ? Number(m[1]) : y;
    }, null);
    adults.push({
      ref: String(a.Id ?? ''),
      first: first ?? full,
      last: last ?? '',
      email: mail,
      newcomer: typeof a.Newcomer === 'boolean' ? a.Newcomer : null,
      membershipYear,
    });
  }
  return {
    formId: String(e.Form?.Id ?? ''),
    formName: e.Form?.Name ?? '',
    entryRef: String(e.Id ?? ''),
    entryNumber: e.Entry?.Number ?? null,
    status: e.Entry?.Status ?? null,
    payment: e.Order?.PaymentStatus ?? null,
    submittedAt: e.Entry?.DateSubmitted ?? e.Entry?.DateCreated ?? null,
    contactEmail: email(e.Email),
    adults,
    children,
    partyAdults: adults.length,
    partyChildren: children.length + possibleChildren,
    noName,
  };
}

#!/usr/bin/env node
// Builds the SQL that loads pulled Cognito registrations. Prints counts only.
//
//   node scripts/engagement/build-registrations.mjs --people <db-people.json> --new-status inactive
//        [--decisions <review.csv>] [--allow-unresolved] [--children all|none|only] [--out <file>] [--review <file>]
//
// --children none leaves child tokens out; --children only writes just them, for loading once
// the token key is confirmed to be backed up.
//
// db-people.json is the people already in the database: [{ id, name, emails: [] }]. Make it
// with a read-only query of person and person_email (see docs/engagement-imports.md).
//
// It REFUSES to write SQL while any attendee needs a decision, or while two new people
// would share a name. It writes a review file instead: fill in the "decision" column with
// new, skip, match:<id>, or as:<another name in this import>, then run again with --decisions. --new-status is required,
// because someone new to the database needs a status and that is a choice.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { csv, parseCsv } from '../lib/leadership-history.mjs';
import {
  identitiesFrom,
  importStatements,
  newNameCollisions,
  parseDecision,
  resolveIdentities,
} from '../lib/cognito-import.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const expand = (p) => (p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const base = expand('~/Documents/ECRS/engagement-export');
const peoplePath = expand(opt('people'));
const newStatus = opt('new-status');
const outPath = expand(opt('out', `${base}/cognito/registrations.sql`));
const reviewPath = expand(opt('review', `${base}/cognito/review.csv`));
const decisionsPath = expand(opt('decisions'));
const childMode = opt('children', 'all'); // all | none | only
if (!peoplePath || !['active', 'hiatus', 'inactive'].includes(newStatus)) {
  console.error(
    'usage: build-registrations.mjs --people <db-people.json> --new-status <active|hiatus|inactive> [--decisions <csv>] [--allow-unresolved]'
  );
  process.exit(2);
}

const reg = JSON.parse(readFileSync(`${base}/cognito/registrations.json`, 'utf8'));
const map = JSON.parse(readFileSync(`${base}/cognito/form-event-map.json`, 'utf8'));
const confirmed = (id) => (map[id]?.confirmed && map[id]?.slug ? map[id].slug : null);
const people = JSON.parse(readFileSync(peoplePath, 'utf8')).map((p) => ({
  ...p,
  emails: (p.emails ?? []).map((e) => e.toLowerCase()),
}));
const overridesPath = expand('~/Documents/ECRS/leadership-export/history-name-overrides.json');
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};
const decisions = new Map();
if (decisionsPath) {
  const [head, ...rows] = parseCsv(readFileSync(decisionsPath, 'utf8'));
  const [k, d] = [head.indexOf('key'), head.indexOf('decision')];
  for (const r of rows) {
    const parsed = parseDecision(r[d]);
    if (parsed) decisions.set(r[k], parsed);
  }
}

const entries = reg.entries.filter((e) => confirmed(e.formId));
const skippedForms = new Set(reg.entries.filter((e) => !confirmed(e.formId)).map((e) => e.formId));
const rows = entries.flatMap((e) => e.adults);
const { identities, sharedEmails } = identitiesFrom(rows);
const { resolved, review, alias } = resolveIdentities(identities, people, { overrides, decisions });
const collisions = newNameCollisions(resolved);

const tally = (how) => resolved.filter((r) => r.how === how).length;
const adultRegs = entries.reduce((n, e) => n + e.adults.length, 0);
console.log(
  `Entries in confirmed forms: ${entries.length} (${reg.entries.length - entries.length} in ${skippedForms.size} unconfirmed or unmapped forms, left out)`
);
console.log(
  `Adult registrations: ${adultRegs}   child tokens: ${entries.reduce((n, e) => n + e.children.length, 0)}   people seen: ${identities.length}`
);
console.log(
  `Matched by exact name: ${tally('name')}   by email with a compatible name: ${tally('email')}   by override: ${tally('override')}   by your decision: ${tally('decided')}`
);
console.log(
  `New to the database: ${tally('new')}   skipped by decision: ${tally('skipped')}   shared email addresses: ${sharedEmails.size}`
);
console.log(`Need a decision: ${review.length}`);

if (review.length) {
  mkdirSync(path.dirname(reviewPath), { recursive: true, mode: 0o700 });
  const lines = [['key', 'name', 'emails', 'registrations', 'reason', 'candidates', 'decision']];
  for (const r of review) {
    lines.push([
      r.id.key,
      r.id.name,
      [...r.id.emails].join(' '),
      r.id.rows,
      r.reason,
      r.candidates.map((c) => `${c.id}:${c.name}`).join('; '),
      '',
    ]);
  }
  writeFileSync(reviewPath, lines.map((l) => l.map(csv).join(',')).join('\n') + '\n', { mode: 0o600 });
  console.log(
    `Wrote ${reviewPath}. Fill in "decision" with new, skip, match:<id>, or as:<another name>, then run again with --decisions.`
  );
}
if (collisions.length) console.log(`REFUSING: ${collisions.length} new people would share a lookup name.`);
if ((review.length && !args.includes('--allow-unresolved')) || collisions.length) {
  console.log('No SQL written.');
  process.exit(review.length || collisions.length ? 1 : 0);
}

const sqls = importStatements({
  resolved,
  entries,
  eventOf: confirmed,
  sharedEmails,
  newStatus,
  alias,
  children: childMode,
});
mkdirSync(path.dirname(outPath), { recursive: true, mode: 0o700 });
writeFileSync(outPath, ['-- Cognito registrations. Safe to run twice. Take a backup first.', '', ...sqls].join('\n'), {
  mode: 0o600,
});
console.log(`Wrote ${sqls.length} statements to ${outPath}. Nothing was sent to a database.`);

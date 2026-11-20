#!/usr/bin/env node
// Builds the SQL that loads memberships from the Cognito membership form (form 16).
// Prints counts only: never a name or an email.
//
//   node scripts/engagement/build-donations.mjs --people <db-people.json> --new-status inactive
//        [--decisions <review.csv>] [--cognito-form 16] [--out <file>] [--review <file>]
//
// Paid, completed entries only; the member and any household members named count, for the year submitted. People are matched like registrations: an
// unclear match goes to a review file and the build refuses to write SQL until it is
// decided. The SQL holds names and emails: delete it after loading.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeGet } from '../lib/cognito-api.mjs';
import { crawlEntries } from '../lib/cognito-crawl.mjs';
import { identitiesFrom, newNameCollisions, parseDecision, resolveIdentities } from '../lib/cognito-import.mjs';
import { membershipRows, membershipStatements } from '../lib/membership-import.mjs';
import { csv, parseCsv } from '../lib/leadership-history.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const home = os.homedir();
const expand = (p) => (p?.startsWith('~') ? path.join(home, p.slice(1)) : p);
const base = expand('~/Documents/ECRS/engagement-export');
const peoplePath = expand(opt('people'));
const newStatus = opt('new-status');
const decisionsPath = expand(opt('decisions'));
const outPath = expand(opt('out', `${base}/membership.sql`));
const reviewPath = expand(opt('review', `${base}/membership-review.csv`));
if (!peoplePath || !['active', 'hiatus', 'inactive'].includes(newStatus)) {
  console.error(
    'usage: build-donations.mjs --people <db-people.json> --new-status <active|hiatus|inactive> [--decisions <csv>]'
  );
  process.exit(2);
}

// Cognito membership form, in memory
const token =
  process.env.COGNITO_API_KEY ?? readFileSync(path.join(home, '.config/ecrs/cognito-api.key'), 'utf8').trim();
const entries = [];
await crawlEntries(makeGet(token), opt('cognito-form', '16'), { onEntry: (e) => entries.push(e) });
const { rows, skipped } = membershipRows(entries);

const people = JSON.parse(readFileSync(peoplePath, 'utf8')).map((p) => ({
  ...p,
  emails: (p.emails ?? []).map((e) => e.toLowerCase()),
}));
const overridesPath = expand('~/Documents/ECRS/leadership-export/history-name-overrides.json');
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};
const decisions = new Map();
if (decisionsPath) {
  const [head, ...body] = parseCsv(readFileSync(decisionsPath, 'utf8'));
  const [k, d] = [head.indexOf('key'), head.indexOf('decision')];
  for (const r of body) {
    const parsed = parseDecision(r[d]);
    if (parsed) decisions.set(r[k], parsed);
  }
}

const { identities, sharedEmails } = identitiesFrom(rows);
const { resolved, review, alias } = resolveIdentities(identities, people, { overrides, decisions });
const collisions = newNameCollisions(resolved);
const tally = (how) => resolved.filter((r) => r.how === how).length;

console.log(
  `Entries: ${entries.length}   members counted: ${rows.length}   left out: ${skipped.incomplete} incomplete, ${skipped.unpaid} unpaid, ${skipped.refunded} refunded, ${skipped.noDate} undated`
);
console.log(
  `Members seen: ${identities.length}   matched by exact name ${tally('name')}, by email ${tally('email')}, by override ${tally('override')}, by your decision ${tally('decided')}`
);
console.log(
  `New to the database: ${tally('new')}   skipped by decision: ${tally('skipped')}   shared emails: ${sharedEmails.size}   need a decision: ${review.length}`
);

if (review.length) {
  mkdirSync(path.dirname(reviewPath), { recursive: true, mode: 0o700 });
  const lines = [['key', 'name', 'emails', 'memberships', 'reason', 'candidates', 'decision']];
  for (const r of review)
    lines.push([
      r.id.key,
      r.id.name,
      [...r.id.emails].join(' '),
      r.id.rows,
      r.reason,
      r.candidates.map((c) => `${c.id}:${c.name}`).join('; '),
      '',
    ]);
  writeFileSync(reviewPath, lines.map((l) => l.map(csv).join(',')).join('\n') + '\n', { mode: 0o600 });
  console.log(
    `Wrote ${reviewPath}. Fill in "decision" (new, skip, match:<id>, as:<name>) and run again with --decisions.`
  );
}
if (review.length || collisions.length) {
  console.log(
    collisions.length
      ? `REFUSING: ${collisions.length} new people would share a lookup name. No SQL written.`
      : 'No SQL written.'
  );
  process.exit(1);
}

const sqls = membershipStatements({ rows, resolved, alias, sharedEmails, newStatus });
mkdirSync(path.dirname(outPath), { recursive: true, mode: 0o700 });
writeFileSync(outPath, ['-- Memberships. Safe to run twice. Take a backup first.', '', ...sqls].join('\n'), {
  mode: 0o600,
});
console.log(`Wrote ${sqls.length} statements to ${outPath}. Nothing was sent to a database.`);

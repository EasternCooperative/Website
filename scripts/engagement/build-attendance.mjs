#!/usr/bin/env node
// Builds the SQL that loads real attendance from attendee lists saved as CSV. Prints counts only.
//
//   node scripts/engagement/build-attendance.mjs --people <db-people.json> --new-status inactive
//        --list <csv>=<event-slug> [--list ...] [--decisions <review.csv>] [--out <file>] [--review <file>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { csv, parseCsv } from '../lib/leadership-history.mjs';
import { identitiesFrom, newNameCollisions, parseDecision, resolveIdentities } from '../lib/cognito-import.mjs';
import { attendeeRows, attendanceStatements } from '../lib/attendance-import.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const expand = (p) => (p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const base = expand('~/Documents/ECRS/engagement-export/attendance');
const peoplePath = expand(opt('people'));
const newStatus = opt('new-status');
const outPath = expand(opt('out', `${base}/attendance.sql`));
const reviewPath = expand(opt('review', `${base}/review.csv`));
const decisionsPath = expand(opt('decisions'));
const lists = args.flatMap((a, i) => (a === '--list' ? [args[i + 1]] : []));
if (!peoplePath || !lists.length || !['active', 'hiatus', 'inactive'].includes(newStatus)) {
  console.error('usage: build-attendance.mjs --people <json> --new-status <status> --list <csv>=<event-slug> ...');
  process.exit(2);
}

const rows = lists.flatMap((l) => {
  const [file, slug] = l.split('=');
  return attendeeRows(parseCsv(readFileSync(expand(file), 'utf8')), slug);
});
const people = JSON.parse(readFileSync(peoplePath, 'utf8')).map((p) => ({
  ...p,
  emails: (p.emails ?? []).map((e) => e.toLowerCase()),
}));
const decisions = new Map();
if (decisionsPath) {
  const [head, ...body] = parseCsv(readFileSync(decisionsPath, 'utf8'));
  const [k, d] = [head.indexOf('key'), head.indexOf('decision')];
  for (const r of body) {
    const parsed = parseDecision(r[d]);
    if (parsed) decisions.set(r[k], parsed);
  }
}
const overridesPath = expand('~/Documents/ECRS/leadership-export/history-name-overrides.json');
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};
const { identities, sharedEmails } = identitiesFrom(rows);
const { resolved, review, alias } = resolveIdentities(identities, people, { overrides, decisions });
const collisions = newNameCollisions(resolved);
const tally = (how) => resolved.filter((r) => r.how === how).length;
console.log(
  `Rows: ${rows.length} (attended ${rows.filter((r) => r.attended).length}, did not attend ${rows.filter((r) => !r.attended).length})   people: ${identities.length}`
);
console.log(
  `Matched by name ${tally('name')}, email ${tally('email')}, override ${tally('override')}, decision ${tally('decided')}   new ${tally('new')}   skipped ${tally('skipped')}   need a decision ${review.length}`
);
if (review.length) {
  mkdirSync(path.dirname(reviewPath), { recursive: true, mode: 0o700 });
  const lines = [['key', 'name', 'emails', 'rows', 'reason', 'candidates', 'decision']];
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
  console.log(`Wrote ${reviewPath}.`);
}
if (review.length || collisions.length) {
  console.log(
    collisions.length ? `REFUSING: ${collisions.length} new people would share a lookup name.` : 'No SQL written.'
  );
  process.exit(1);
}
const sqls = attendanceStatements({ rows, resolved, alias, sharedEmails, newStatus });
writeFileSync(outPath, ['-- Attendance. Safe to run twice. Take a backup first.', '', ...sqls].join('\n'), {
  mode: 0o600,
});
console.log(`Wrote ${sqls.length} statements to ${outPath}. Nothing was sent to a database.`);

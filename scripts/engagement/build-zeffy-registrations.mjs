#!/usr/bin/env node
// Builds the SQL that loads Zeffy ticket purchases as event registrations. Prints counts only.
//
//   node scripts/engagement/build-attendance.mjs --people <db-people.json> --new-status inactive
//        --zeffy <All_payments.xlsx> [--decisions <review.csv>] [--out <file>] [--review <file>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { csv, parseCsv } from '../lib/leadership-history.mjs';
import { identitiesFrom, newNameCollisions, parseDecision, resolveIdentities } from '../lib/cognito-import.mjs';
import * as XLSX from 'xlsx';
import { ticketRegistrations, ticketStatements } from '../lib/zeffy-registrations.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const expand = (p) => (p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const base = expand('~/Documents/ECRS/engagement-export');
const peoplePath = expand(opt('people'));
const newStatus = opt('new-status');
const outPath = expand(opt('out', `${base}/zeffy-registrations.sql`));
const reviewPath = expand(opt('review', `${base}/zeffy-review.csv`));
const decisionsPath = expand(opt('decisions'));
const zeffyPath = expand(opt('zeffy'));
if (!peoplePath || !zeffyPath || !['active', 'hiatus', 'inactive'].includes(newStatus)) {
  console.error('usage: build-zeffy-registrations.mjs --people <json> --new-status <status> --zeffy <xlsx>');
  process.exit(2);
}

const [header, ...sheet] = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(zeffyPath)).Sheets.Export, {
  header: 1,
  raw: true,
  defval: null,
});
const rows = ticketRegistrations(header, sheet);
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
console.log(`Rows: ${rows.length}    people: ${identities.length}`);
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
const sqls = ticketStatements({ rows, resolved, alias, sharedEmails, newStatus });
writeFileSync(
  outPath,
  ['-- Zeffy ticket registrations. Safe to run twice. Take a backup first.', '', ...sqls].join('\n'),
  {
    mode: 0o600,
  }
);
console.log(`Wrote ${sqls.length} statements to ${outPath}. Nothing was sent to a database.`);

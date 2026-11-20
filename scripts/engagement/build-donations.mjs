#!/usr/bin/env node
// Builds the SQL that loads gifts from a Zeffy export and the Cognito donation form.
// Prints counts only: never an amount, a name, or an email.
//
//   node scripts/engagement/build-donations.mjs --zeffy <All_payments.xlsx> --people <db-people.json> --new-status inactive
//        [--decisions <review.csv>] [--cognito-form 24] [--include-sliding] [--out <file>] [--review <file>]
//
// Gifts under $2 are dropped as test payments. People are matched like registrations: an
// unclear match goes to a review file and the build refuses to write SQL until it is
// decided. The SQL holds names, emails, and amounts: delete it after loading.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { makeGet } from '../lib/cognito-api.mjs';
import { crawlEntries } from '../lib/cognito-crawl.mjs';
import { identitiesFrom, newNameCollisions, parseDecision, resolveIdentities } from '../lib/cognito-import.mjs';
import { cognitoGiftRows, donationStatements, zeffyDonationRows } from '../lib/donation-import.mjs';
import { withoutTestGifts, zeffyGiftRows } from '../lib/giving-bands.mjs';
import { csv, parseCsv } from '../lib/leadership-history.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const home = os.homedir();
const expand = (p) => (p?.startsWith('~') ? path.join(home, p.slice(1)) : p);
const base = expand('~/Documents/ECRS/engagement-export');
const zeffyPath = expand(opt('zeffy'));
const peoplePath = expand(opt('people'));
const newStatus = opt('new-status');
const decisionsPath = expand(opt('decisions'));
const outPath = expand(opt('out', `${base}/donations.sql`));
const reviewPath = expand(opt('review', `${base}/donations-review.csv`));
if (!zeffyPath || !peoplePath || !['active', 'hiatus', 'inactive'].includes(newStatus)) {
  console.error(
    'usage: build-donations.mjs --zeffy <xlsx> --people <db-people.json> --new-status <active|hiatus|inactive> [--decisions <csv>]'
  );
  process.exit(2);
}

// Zeffy
const [header, ...sheet] = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(zeffyPath)).Sheets.Export, {
  header: 1,
  raw: true,
  defval: null,
});
const zeffy = zeffyGiftRows(header, sheet, { includeSliding: args.includes('--include-sliding') });

// Cognito donation form, in memory
const token =
  process.env.COGNITO_API_KEY ?? readFileSync(path.join(home, '.config/ecrs/cognito-api.key'), 'utf8').trim();
const entries = [];
await crawlEntries(makeGet(token), opt('cognito-form', '24'), { onEntry: (e) => entries.push(e) });
const cognito = cognitoGiftRows(entries);

const real = withoutTestGifts([...zeffyDonationRows(zeffy.rows), ...cognito]);
const rows = real.gifts;
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
  `Gifts: ${rows.length} (Zeffy donation payments ${zeffy.counted.donationPayments}, Zeffy gift lines in tickets ${zeffy.counted.giftLines}, Cognito form ${cognito.length})`
);
console.log(
  `Dropped as likely test payments (under $2): ${real.dropped}   Zeffy sliding-scale ticket lines left out: ${zeffy.counted.slidingExcluded}`
);
console.log(
  `Donors seen: ${identities.length}   matched by exact name ${tally('name')}, by email ${tally('email')}, by override ${tally('override')}, by your decision ${tally('decided')}`
);
console.log(
  `New to the database: ${tally('new')}   skipped by decision: ${tally('skipped')}   shared emails: ${sharedEmails.size}   need a decision: ${review.length}`
);

if (review.length) {
  mkdirSync(path.dirname(reviewPath), { recursive: true, mode: 0o700 });
  const lines = [['key', 'name', 'emails', 'gifts', 'reason', 'candidates', 'decision']];
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

const sqls = donationStatements({ rows, resolved, alias, sharedEmails, newStatus });
mkdirSync(path.dirname(outPath), { recursive: true, mode: 0o700 });
writeFileSync(outPath, ['-- Gifts. Safe to run twice. Take a backup first.', '', ...sqls].join('\n'), { mode: 0o600 });
console.log(`Wrote ${sqls.length} statements to ${outPath}. Nothing was sent to a database.`);

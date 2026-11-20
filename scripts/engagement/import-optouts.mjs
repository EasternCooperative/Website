#!/usr/bin/env node
// Marks people who unsubscribed from the newsletter as do-not-contact. Prints counts only.
//
//   node scripts/engagement/import-optouts.mjs --csv <unsubscribed export.csv> --people <db-people.json> [--out <file>]
//
// Unzip the Mailchimp audience export, and use the "unsubscribed" file. db-people.json is
// [{ id, name, emails }] from the database (see docs/engagement-imports.md). The CSV holds
// names and emails: delete it and the SQL after loading.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCsv } from '../lib/leadership-history.mjs';
import { optoutStatements } from '../lib/optouts.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const expand = (p) => (p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const csvPath = expand(opt('csv'));
const peoplePath = expand(opt('people'));
const outPath = expand(opt('out', '~/Documents/ECRS/engagement-export/optouts.sql'));
if (!csvPath || !peoplePath) {
  console.error('usage: import-optouts.mjs --csv <unsubscribed.csv> --people <db-people.json> [--out <file>]');
  process.exit(2);
}

const stripBom = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t); // a byte-order mark some exports start with
const [head, ...body] = parseCsv(stripBom(readFileSync(csvPath, 'utf8')));
const col = (n) => head.findIndex((h) => h.trim().toLowerCase() === n);
const [e, f, l] = [col('email'), col('first name'), col('last name')];
const rows = body.filter((r) => r.length > 1).map((r) => ({ email: r[e], first: r[f], last: r[l] }));
const people = JSON.parse(readFileSync(peoplePath, 'utf8')).map((p) => ({
  ...p,
  emails: (p.emails ?? []).map((x) => x.toLowerCase()),
}));

const r = optoutStatements(rows, people);
console.log(`Unsubscribed rows: ${rows.length}`);
console.log(
  `People marked do-not-contact: ${r.marked} (by address ${r.byEmail}, by exact name ${r.byName}); shared addresses: ${r.sharedAddresses}`
);
console.log(`Not in the database (nothing to mark): ${r.unmatched}`);
mkdirSync(path.dirname(outPath), { recursive: true, mode: 0o700 });
writeFileSync(outPath, ['-- Newsletter opt-outs. Safe to run twice.', '', ...r.statements].join('\n'), { mode: 0o600 });
console.log(`Wrote ${r.statements.length} statements to ${outPath}. Nothing was sent to a database.`);

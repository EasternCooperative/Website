#!/usr/bin/env node
// Builds the SQL that records where people live, to the postal code, from Cognito and Zeffy.
// Prints counts only. Only people already in the database get a location.
//
//   node scripts/engagement/build-locations.mjs --people <db-people.json> [--zeffy <All_payments.xlsx>] [--out <file>]
//
// Reads Cognito entries straight from the API in memory (registration forms from
// cognito/form-event-map.json, plus the membership form 16 and the donation form 24), keeps
// city, state, and postal code, and discards everything else. The SQL holds postal codes
// tied to person ids: delete it after loading.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { makeGet } from '../lib/cognito-api.mjs';
import { crawlEntries } from '../lib/cognito-crawl.mjs';
import { cognitoLocationRows, locationStatements, zeffyLocationRows } from '../lib/location-import.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const home = os.homedir();
const expand = (p) => (p?.startsWith('~') ? path.join(home, p.slice(1)) : p);
const base = expand('~/Documents/ECRS/engagement-export');
const peoplePath = expand(opt('people'));
const zeffyPath = expand(opt('zeffy'));
const outPath = expand(opt('out', `${base}/locations.sql`));
if (!peoplePath) {
  console.error('usage: build-locations.mjs --people <db-people.json> [--zeffy <xlsx>] [--out <file>]');
  process.exit(2);
}

const token =
  process.env.COGNITO_API_KEY ?? readFileSync(path.join(home, '.config/ecrs/cognito-api.key'), 'utf8').trim();
const map = JSON.parse(readFileSync(`${base}/cognito/form-event-map.json`, 'utf8'));
const forms = [
  ...Object.entries(map)
    .filter(([, v]) => v.confirmed && v.slug)
    .map(([id]) => id),
  '16',
  '24',
];
const get = makeGet(token);
const rows = [];
for (const f of forms) {
  const entries = [];
  await crawlEntries(get, f, { onEntry: (e) => entries.push(e) });
  const got = cognitoLocationRows(entries, f);
  rows.push(...got);
  console.log(`form ${f}: ${entries.length} entries, ${got.length} with a US postal code`);
}
if (zeffyPath) {
  const [header, ...sheet] = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(zeffyPath)).Sheets.Export, {
    header: 1,
    raw: true,
    defval: null,
  });
  const z = zeffyLocationRows(header, sheet);
  rows.push(...z);
  console.log(`Zeffy: ${z.length} payments with a US postal code`);
}

const people = JSON.parse(readFileSync(peoplePath, 'utf8')).map((p) => ({
  ...p,
  emails: (p.emails ?? []).map((e) => e.toLowerCase()),
}));
const overridesPath = expand('~/Documents/ECRS/leadership-export/history-name-overrides.json');
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};
const { statements, counts } = locationStatements({ rows, people, overrides });
console.log(
  `Rows ${counts.rows}, people seen ${counts.people}: located ${counts.located}, left out for review ${counts.needDecision}, not in the database ${counts.notInDatabase}`
);
mkdirSync(path.dirname(outPath), { recursive: true, mode: 0o700 });
writeFileSync(outPath, ['-- Locations. Safe to run twice. Take a backup first.', '', ...statements].join('\n'), {
  mode: 0o600,
});
console.log(`Wrote ${statements.length} statements to ${outPath}. Nothing was sent to a database.`);

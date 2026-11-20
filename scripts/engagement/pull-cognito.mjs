#!/usr/bin/env node
// Pulls event-registration entries from Cognito Forms straight to disk, reduced to the
// minimum (see scripts/lib/cognito-extract.mjs). Prints only counts, never a name.
//
//   node scripts/engagement/pull-cognito.mjs [--forms 131,125] [--out <dir>] [--batch 5] [--resume] [--redo]
//
// Cognito rate-limits, so requests go in small batches with backoff. The output is saved
// after every form, and --resume skips forms already saved, so an interrupted run carries on.
//
// Children's names are hashed in memory with a key kept at ~/.config/ecrs/child-token.key
// (created on first run, owner-only) and are never written. Treat the output as TEMPORARY:
// it holds names and emails, and the erase action cannot reach files on disk. Delete it
// after a successful load. Needs COGNITO_API_KEY, or ~/.config/ecrs/cognito-api.key.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { crawlEntries } from '../lib/cognito-crawl.mjs';
import { extractEntry } from '../lib/cognito-extract.mjs';

// Event registration forms, 2018 to 2026. Class registrations list the same people for
// the same events, and proposals are a leadership signal for later, so neither is here.
const DEFAULT_FORMS = [
  29, 30, 31, 32, 33, 40, 44, 45, 48, 49, 50, 52, 53, 54, 55, 63, 68, 69, 74, 79, 84, 86, 91, 95, 97, 102, 108, 111,
  116, 121, 125, 131,
];

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const home = os.homedir();
const expand = (p) => (p?.startsWith('~') ? path.join(home, p.slice(1)) : p);
const outDir = expand(opt('out', '~/Documents/ECRS/engagement-export/cognito'));
const batchSize = Number(opt('batch', 5));
const resume = args.includes('--resume');
const redo = args.includes('--redo'); // with --forms: drop those forms from the saved file and pull them again
const forms = opt('forms') ? opt('forms').split(',').map(String) : DEFAULT_FORMS.map(String);

const token =
  process.env.COGNITO_API_KEY ?? readFileSync(path.join(home, '.config/ecrs/cognito-api.key'), 'utf8').trim();

// The child-token key: made once, kept outside the export folder and the repository.
const keyPath = path.join(home, '.config/ecrs/child-token.key');
let freshKey = false;
if (!existsSync(keyPath)) {
  mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  writeFileSync(keyPath, randomBytes(32).toString('hex'), { mode: 0o600 });
  freshKey = true;
}
chmodSync(keyPath, 0o600);
const key = readFileSync(keyPath, 'utf8').trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => {
  for (let attempt = 0; attempt < 8; attempt++) {
    let res;
    try {
      res = await fetch(`https://www.cognitoforms.com/api${p}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000), // a hung request must not stall the whole pull
      });
    } catch {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (res.status === 404) return null;
    if (res.status === 429) {
      const header = res.headers.get('Retry-After') ?? '';
      const asked = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
      await sleep(Math.min(60_000, Math.max(Number.isFinite(asked) ? asked : 0, 1000 * 2 ** attempt)));
      continue;
    }
    if (!res.ok) throw new Error(`Cognito API ${res.status}`);
    return res.json();
  }
  throw new Error('Cognito API kept failing or rate-limiting');
};

const file = path.join(outDir, 'registrations.json');
mkdirSync(outDir, { recursive: true, mode: 0o700 });
chmodSync(outDir, 0o700);
const saved = resume && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { entries: [], forms: [] };
if (redo) {
  saved.entries = saved.entries.filter((e) => !forms.includes(String(e.formId)));
  saved.forms = saved.forms.filter((f) => !forms.includes(String(f.formId)));
}
const entries = saved.entries;
const summary = saved.forms;
const save = () =>
  writeFileSync(file, JSON.stringify({ pulledAt: new Date().toISOString(), forms: summary, entries }), { mode: 0o600 });
let skippedIncomplete = 0;
for (const formId of forms) {
  if (summary.some((f) => f.formId === formId)) {
    console.log(`[${String(formId).padStart(3)}] already saved, skipping`);
    continue;
  }
  let name = '';
  const mine = [];
  process.stderr.write(`[${String(formId).padStart(3)}] starting\n`);
  const { found, highest } = await crawlEntries(get, formId, {
    batch: batchSize,
    onEntry: (e) => {
      name ||= e.Form?.Name ?? '';
      const r = extractEntry(e, { key });
      if (r.skip) skippedIncomplete++;
      else mine.push(r);
    },
  });
  entries.push(...mine);
  summary.push({ formId, name, found, highest, kept: mine.length });
  save();
  const adults = mine.reduce((n, r) => n + r.adults.length, 0);
  const kids = mine.reduce((n, r) => n + r.partyChildren, 0);
  console.log(
    `[${String(formId).padStart(3)}] ${name.slice(0, 54).padEnd(54)} found ${String(found).padStart(3)} of #${String(highest).padStart(3)}, kept ${String(mine.length).padStart(3)}, adults ${String(adults).padStart(3)}, children ${String(kids).padStart(2)}`
  );
}

save();
console.log(
  `\n${entries.length} entries kept, ${skippedIncomplete} incomplete skipped this run, ${entries.reduce((n, r) => n + r.adults.length, 0)} adult registrations, ${entries.reduce((n, r) => n + r.children.length, 0)} child tokens.`
);
console.log(`Wrote ${file} (names and emails: temporary, delete after the load).`);
if (freshKey) {
  console.log(
    `\nA new child-token key was created at ${keyPath}. Back it up in the password manager BEFORE any tokens reach production: losing it breaks matching, and it must not live in the database or the repo.`
  );
}

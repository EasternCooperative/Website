#!/usr/bin/env node
// Proposes which site event each pulled Cognito form belongs to, and keeps the answer in
// a file for a person to confirm. Nothing is loaded for a form until it is confirmed.
//
//   node scripts/engagement/map-forms.mjs [--registrations <file>] [--map <file>] [--confirm]
//
// The map is { "131": { "name": "...", "slug": "2026-winter-adventure", "confirmed": false } }.
// Edit a slug by hand, or set it to null to skip a form. --confirm marks every form that
// has a slug as confirmed. Forms already confirmed are left alone on later runs.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import { proposeMapping } from '../lib/form-event-map.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const expand = (p) => (p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const dir = expand('~/Documents/ECRS/engagement-export/cognito');
const regPath = expand(opt('registrations', `${dir}/registrations.json`));
const mapPath = expand(opt('map', `${dir}/form-event-map.json`));

const DATA = new URL('../../src/data/events/', import.meta.url).pathname;
const events = readdirSync(DATA)
  .filter((f) => f.endsWith('.md') && !f.startsWith('e2e-'))
  .map((f) => {
    const d = load(readFileSync(path.join(DATA, f), 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '') ?? {};
    return { slug: f.replace(/\.md$/, ''), title: String(d.title ?? ''), year: Number(String(d.date).slice(0, 4)) };
  });

const forms = JSON.parse(readFileSync(regPath, 'utf8')).forms.map((f) => ({ formId: f.formId, name: f.name }));
const existing = (() => {
  try {
    return JSON.parse(readFileSync(mapPath, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
})();
const map = { ...existing };
for (const p of proposeMapping(forms, events)) {
  if (existing[p.formId]?.confirmed) continue;
  map[p.formId] = {
    name: p.name,
    slug: existing[p.formId]?.slug ?? p.slug,
    confirmed: false,
    hint: p.slug ? undefined : p.runnerUp,
  };
}
if (args.includes('--confirm')) for (const v of Object.values(map)) if (v.slug) v.confirmed = true;

mkdirSync(path.dirname(mapPath), { recursive: true, mode: 0o700 });
writeFileSync(mapPath, JSON.stringify(map, null, 2), { mode: 0o600 });

const rows = Object.entries(map);
console.log('Form  Cognito form name'.padEnd(66) + 'Event');
for (const [id, v] of rows) {
  const status = v.slug
    ? `${v.slug}${v.confirmed ? '  (confirmed)' : ''}`
    : `UNMAPPED${v.hint ? `  (closest: ${v.hint})` : ''}`;
  console.log(`${id.padStart(4)}  ${v.name.slice(0, 58).padEnd(58)}  ${status}`);
}
const unmapped = rows.filter(([, v]) => !v.slug).length;
console.log(
  `\n${rows.length} forms: ${rows.length - unmapped} proposed or confirmed, ${unmapped} unmapped. Map saved to ${mapPath}`
);

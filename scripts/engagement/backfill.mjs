#!/usr/bin/env node
// Writes the SQL that backfills engagement basics, and reports what it would do.
//
//   node scripts/engagement/backfill.mjs --people <people-names.json> [--service <service-history.json>] [--out <file>]
//
//   1. Events: every event in the site content gets a database event (the one existing
//      event with no link is linked instead), plus its Cognito form and Zeffy page.
//   2. Leader pages: people whose name matches a leader page get its slug.
//   3. Service: dated board and committee history from a PRIVATE file, plus who serves
//      now from the Our People page. Former names are resolved through the private
//      name-overrides file, so none appear in this repository. People who are on the
//      board or a committee but not in the database are skipped unless you pass
//      --create-missing <active|hiatus|inactive>, which adds them with that status.
//
// Nothing here touches a database. Run the SQL yourself, after a backup.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import { eventType, makeResolver, tidy } from '../lib/leadership-history.mjs';
import {
  currentService,
  eventStatements,
  mergeCurrent,
  personStatement,
  resolveService,
  serviceStatement,
  slugStatement,
} from '../lib/engagement-backfill.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const expand = (p) => (p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const peoplePath = expand(opt('people'));
const servicePath = expand(opt('service'));
const createStatus = opt('create-missing');
if (createStatus && !['active', 'hiatus', 'inactive'].includes(createStatus)) {
  console.error('--create-missing takes active, hiatus, or inactive');
  process.exit(2);
}
const outPath = expand(opt('out', '~/Documents/ECRS/engagement-export/engagement-backfill.sql'));
if (!peoplePath) {
  console.error('usage: backfill.mjs --people <people-names.json> [--service <service-history.json>] [--out <file>]');
  process.exit(2);
}

const DATA = new URL('../../src/data/', import.meta.url).pathname;
const frontmatter = (file) => load(readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '') ?? {};
const records = (sub) =>
  readdirSync(path.join(DATA, sub))
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ id: f.replace(/\.md$/, ''), ...frontmatter(path.join(DATA, sub, f)) }))
    .filter((r) => r.name);
const today = new Date().toISOString().slice(0, 10);
const peopleNames = JSON.parse(readFileSync(peoplePath, 'utf8'));
const statements = ['-- Engagement backfill. Safe to run twice. Take a backup first.', ''];
const report = [];

// ---- 1. Events ----
const isoDay = (v) => (v ? String(v).slice(0, 10) : null);
const lastSegment = (u) => String(u).split('?')[0].replace(/\/+$/, '').split('/').pop();
const events = readdirSync(path.join(DATA, 'events'))
  .filter((f) => f.endsWith('.md') && !f.startsWith('e2e-'))
  .sort()
  .map((f) => {
    const slug = f.replace(/\.md$/, '');
    const d = frontmatter(path.join(DATA, 'events', f));
    const forms = [
      ...[d.cognitoFormId, d.classRegistrationFormId]
        .filter(Boolean)
        .map((ref) => ({ source: 'cognito', ref: String(ref) })),
      ...(d.zeffyFormUrl ? [{ source: 'zeffy', ref: lastSegment(d.zeffyFormUrl) }] : []),
    ];
    return {
      slug,
      title: tidy(d.title),
      year: Number(String(d.date).slice(0, 4)),
      type: eventType(d.date, d.endDate),
      start: isoDay(d.date),
      end: isoDay(d.endDate),
      siteId: d.siteId ? String(d.siteId) : null,
      forms,
    };
  });
statements.push('-- Events', ...events.flatMap(eventStatements), '');
report.push(
  `Events in the site content: ${events.length} (the database already holds 51; any without a link are linked, the rest added)`
);
report.push(
  `Form links recorded: ${events.reduce((n, e) => n + e.forms.length, 0)} (older Cognito forms need a mapping file, which comes with the imports)`
);

// ---- 2. Leader pages ----
const leaders = records('leaders');
statements.push('-- Leader pages', ...leaders.map(slugStatement), '');
report.push(`Leader pages checked against people: ${leaders.length}`);

// ---- 3. Service ----
if (servicePath) {
  const overridesPath = expand('~/Documents/ECRS/leadership-export/history-name-overrides.json');
  const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};
  const resolve = makeResolver({
    directory: [...records('leaders'), ...records('staff')],
    existing: peopleNames,
    overrides,
  });
  const canon = (n) => resolve({ name: n })?.name ?? n;
  const dated = JSON.parse(readFileSync(servicePath, 'utf8'));
  const page = JSON.parse(readFileSync(path.join(DATA, 'pages/people.json'), 'utf8'));
  const merged = mergeCurrent(dated, currentService(page), canon, today);
  let { resolved, unresolved } = resolveService(merged, resolve, peopleNames);
  let created = [];
  if (createStatus && unresolved.size) {
    created = [...new Set([...unresolved.keys()].map((n) => canon(n)))];
    statements.push(`-- People on the board or a committee who are not in the database yet (status: ${createStatus})`);
    statements.push(...created.map((n) => personStatement(n, createStatus)), '');
    ({ resolved, unresolved } = resolveService(merged, resolve, [...peopleNames, ...created]));
  }
  statements.push('-- Board and committee service', ...resolved.map(serviceStatement), '');
  if (created.length) report.push(`People to add as ${createStatus}: ${created.length}`);
  const byBody = new Map();
  for (const r of resolved) byBody.set(r.body, (byBody.get(r.body) ?? 0) + 1);
  report.push(`Service rows ready: ${resolved.length} of ${merged.length}`);
  for (const [b, n] of [...byBody].sort((a, b) => b[1] - a[1])) report.push(`    ${String(n).padStart(3)}  ${b}`);
  if (unresolved.size) {
    report.push(`Not in the database yet (skipped, needs a decision): ${unresolved.size} people`);
    for (const [n, c] of unresolved) report.push(`    ${n} (${c} ${c === 1 ? 'entry' : 'entries'})`);
  }
}

mkdirSync(path.dirname(outPath), { recursive: true, mode: 0o700 });
writeFileSync(outPath, statements.join('\n'), { mode: 0o600 });
console.log(report.join('\n'));
console.log(
  `\nWrote ${statements.filter((s) => /^(INSERT|UPDATE)/.test(s)).length} statements to ${outPath}. Nothing was sent to a database.`
);

#!/usr/bin/env node
// Bootstraps the leadership tracker from historic event rosters
// (src/data/events/*.md), so the dashboard starts with real history.
//
//   node scripts/import-leadership-history.mjs <export-dir> [--sql out.sql]
//
// <export-dir> is the folder with the sheet export (people.json, activities.json,
// events.json, roles.json), which stands for what the database already holds. It
// must live OUTSIDE the repo: it and everything written here hold personal data.
//
// Without --sql this is a dry run. It writes review files into <export-dir>, and
// reads them back on the next run, so your edits are kept:
//   history-types.csv    class, type, subtype, ...   edit "type" to fix a class; SKIP drops it
//   history-status.csv   name, ..., status, mentor, note
//                        new people only. Anyone who last led in 2018 or later is
//                        left BLANK for a person to decide; older ones get a proposal.
//   history-name-overrides.json   { "raw name": "Canonical Name" }   optional
// Also written, for reading only: history-events.csv, history-possible-duplicates.csv.
//
// --sql writes SQL that is safe to re-run (every insert checks first). It refuses
// to run while any new person still has no status.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import {
  SKIP,
  STATUSES,
  TYPES,
  classRoles,
  classifyActivity,
  csv,
  defaultStatus,
  eventType,
  isYes,
  makeResolver,
  nearDuplicates,
  normalizeType,
  norm,
  parseCsv,
  refreshProposal,
  sql,
  tidy,
} from './lib/leadership-history.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const dir = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const sqlOut = flag('--sql');
if (!dir) {
  console.error('usage: import-leadership-history.mjs <export-dir> [--sql out.sql]');
  process.exit(2);
}

const DATA = new URL('../src/data/', import.meta.url).pathname;
const frontmatter = (file) => load(readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '') ?? {};
const readJson = (name, fallback) => {
  const p = path.join(dir, name);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback;
};
/** A review CSV as Map(norm(first column) -> { header: value }), or an empty map. */
const readTable = (name) => {
  const p = path.join(dir, name);
  if (!existsSync(p)) return new Map();
  const [head, ...rows] = parseCsv(readFileSync(p, 'utf8'));
  return new Map(rows.map((r) => [norm(r[0]), Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))]));
};
const records = (sub) =>
  readdirSync(path.join(DATA, sub))
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ id: f.replace(/\.md$/, ''), name: frontmatter(path.join(DATA, sub, f)).name }))
    .filter((r) => r.name);

// What the database already holds, from the sheet export.
const existingPeople = readJson('people.json', [])
  .slice(1)
  .map((r) => tidy(r[2]) || tidy(`${r[0]} ${r[1]}`));
const existingActivities = new Map(
  readJson('activities.json', [])
    .slice(1)
    .map((r) => [
      norm(r[0]),
      { name: tidy(r[0]), scope: String(r[1]).toLowerCase(), ...normalizeType(tidy(r[2]), tidy(r[3])) },
    ])
);
const existingEvents = readJson('events.json', [])
  .slice(1)
  .map((r) => ({ name: tidy(r[1]), year: Number(r[2]) }));
const sheetRoles = readJson('roles.json', []).slice(1);
const typesTable = readTable('history-types.csv');
const statusTable = readTable('history-status.csv');

const resolve = makeResolver({
  directory: [...records('leaders'), ...records('staff')],
  existing: existingPeople,
  overrides: readJson('history-name-overrides.json', {}),
});

const problems = [];

// ---- Which events count -----------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const included = [];
const skipped = [];
for (const file of readdirSync(path.join(DATA, 'events'))
  .filter((f) => f.endsWith('.md'))
  .sort()) {
  const slug = file.replace(/\.md$/, '');
  const d = frontmatter(path.join(DATA, 'events', file));
  if (!d.classes?.length) continue;
  const start = String(d.date).slice(0, 10);
  const year = Number(start.slice(0, 4));
  const title = tidy(d.title);
  if (slug.startsWith('e2e-')) skipped.push([slug, 'test fixture']);
  else if (start > today) skipped.push([slug, 'has not happened yet']);
  else if (existingEvents.some((e) => e.year === year && title.toLowerCase().includes(e.name.toLowerCase())))
    skipped.push([slug, 'already in the database', d]);
  else included.push({ slug, title, year, type: eventType(d.date, d.endDate), classes: d.classes });
}

// ---- Roles, activities, people ---------------------------------------------
const activities = new Map(); // norm(name) -> info
const people = new Map(); // norm(name) -> info
const roles = [];

function noteActivity(rawName, year) {
  const key = norm(rawName);
  let a = activities.get(key);
  if (!a) {
    const known = existingActivities.get(key);
    const saved = typesTable.get(key);
    const guess = classifyActivity(rawName);
    // The sheet wins, then whatever is saved in the review file, then the rules.
    // A saved row keeps its own subtype (blank included): only rules fill gaps.
    const refreshed = !known && saved?.type ? refreshProposal(saved, guess) : null;
    const { type, subtype } = known
      ? known
      : refreshed
        ? normalizeType(refreshed.type, refreshed.subtype)
        : saved?.type
          ? normalizeType(saved.type, saved.subtype)
          : normalizeType(guess.type, guess.subtype);
    if (type !== SKIP && !TYPES.includes(type)) problems.push(`"${tidy(rawName)}" has an unknown type "${type}"`);
    a = {
      name: known?.name ?? tidy(rawName),
      existing: !!known,
      skip: type === SKIP,
      type,
      subtype,
      basis: known ? 'sheet' : refreshed?.basis || saved?.basis || (guess.rule ? `rule: ${guess.rule}` : 'no match'),
      times: 0,
      lastYear: year,
    };
    activities.set(key, a);
  }
  a.times++;
  a.lastYear = Math.max(a.lastYear, year);
  return a;
}

function collect(event, into) {
  for (const cls of event.classes) {
    const activity = noteActivity(cls.name, event.year);
    if (activity.skip) continue; // marked SKIP in history-types.csv: not a class
    for (const { person, leadership_type } of classRoles(cls, resolve)) {
      const key = norm(person.name);
      const p = people.get(key) ?? {
        name: person.name,
        hows: new Set(),
        events: new Set(),
        roles: 0,
        first: event.year,
        last: event.year,
        isNew: !existingPeople.some((n) => norm(n) === key),
      };
      p.hows.add(person.how);
      p.events.add(event.slug);
      p.roles++;
      p.first = Math.min(p.first, event.year);
      p.last = Math.max(p.last, event.year);
      people.set(key, p);
      into.push({ event: event.slug, activity: activity.name, person: person.name, leadership_type });
    }
  }
}
for (const e of included) collect(e, roles);

// ---- Cross-check the rules against the sheet, on an event that is in both ----
const checks = [];
for (const [slug, reason, d] of skipped) {
  if (reason !== 'already in the database') continue;
  const mine = [];
  collect({ slug, year: Number(String(d.date).slice(0, 4)), classes: d.classes }, mine);
  const key = (p, a, t) => `${norm(p)}|${norm(a)}|${t}`;
  const sheetClassRoles = sheetRoles.filter((r) => existingActivities.get(norm(r[1]))?.scope === 'class');
  const have = new Set(sheetClassRoles.map((r) => key(r[0], r[1], String(r[3]).toLowerCase())));
  const got = new Set(mine.map((m) => key(m.person, m.activity, m.leadership_type)));
  checks.push({
    slug,
    sheet: have.size,
    derived: got.size,
    missingFromDerived: [...have].filter((k) => !got.has(k)),
    extraInDerived: [...got].filter((k) => !have.has(k)),
  });
}

// ---- Statuses for new people -------------------------------------------------
const newPeople = [...people.values()].filter((p) => p.isNew);
for (const p of newPeople) {
  const saved = statusTable.get(norm(p.name));
  const proposal = defaultStatus({ events: p.events.size, lastYear: p.last });
  p.status = saved?.status || proposal?.status || '';
  p.basis = saved?.status ? saved.basis || 'you' : (proposal?.basis ?? `led ${p.last}: your call`);
  p.mentor = isYes(saved?.mentor);
  p.note = saved?.note ?? '';
  if (p.status && !STATUSES.includes(p.status))
    problems.push(`${p.name}: status "${p.status}" is not one of ${STATUSES.join(', ')}`);
}
const needStatus = newPeople.filter((p) => !p.status);

// ---- Review files ------------------------------------------------------------
const write = (name, header, rows) =>
  writeFileSync(path.join(dir, name), [header, ...rows].map((r) => r.map(csv).join(',')).join('\n') + '\n');

write(
  'history-events.csv',
  ['slug', 'name', 'type', 'year', 'classes'],
  included.map((e) => [e.slug, e.title, e.type, e.year, e.classes.length])
);
write(
  'history-types.csv',
  ['class', 'type', 'subtype', 'basis', 'times', 'last year'],
  [...activities.values()]
    .filter((a) => !a.existing)
    .sort((a, b) => b.times - a.times || a.name.localeCompare(b.name))
    .map((a) => [a.name, a.type, a.subtype, a.basis, a.times, a.lastYear])
);
write(
  'history-status.csv',
  ['name', 'status', 'mentor', 'note', 'basis', 'events', 'roles', 'first year', 'last year'],
  newPeople
    .sort((a, b) => b.last - a.last || a.name.localeCompare(b.name))
    .map((p) => [p.name, p.status, p.mentor ? 'yes' : '', p.note, p.basis, p.events.size, p.roles, p.first, p.last])
);
write(
  'history-possible-duplicates.csv',
  ['a', 'b'],
  nearDuplicates([...people.values()].map((p) => p.name).concat(existingPeople))
);

// ---- SQL ---------------------------------------------------------------------
let wroteSql = false;
if (sqlOut && (problems.length || needStatus.length)) {
  console.error(
    `Not writing SQL: ${problems.length} problem(s), ${needStatus.length} new people still without a status.`
  );
  for (const p of problems) console.error(`  - ${p}`);
} else if (sqlOut) {
  const out = [];
  for (const p of newPeople) {
    out.push(
      `INSERT INTO person (name, status, mentor, notes) SELECT ${sql(p.name)}, ${sql(p.status)}, ${p.mentor ? 1 : 0}, ${sql(p.note)} WHERE NOT EXISTS (SELECT 1 FROM person WHERE name = ${sql(p.name)} AND deleted_at IS NULL);`
    );
  }
  for (const e of included) {
    out.push(
      `INSERT INTO event (name, event_type, year, site_event_id) SELECT ${sql(e.title)}, ${sql(e.type)}, ${e.year}, ${sql(e.slug)} WHERE NOT EXISTS (SELECT 1 FROM event WHERE site_event_id = ${sql(e.slug)});`
    );
  }
  for (const a of activities.values()) {
    if (a.existing || a.skip) continue;
    out.push(
      `INSERT INTO activity (name, scope, type, subtype) SELECT ${sql(a.name)}, 'class', ${sql(a.type)}, ${sql(a.subtype)} WHERE NOT EXISTS (SELECT 1 FROM activity WHERE name = ${sql(a.name)} AND deleted_at IS NULL);`
    );
  }
  for (const r of roles) {
    out.push(
      `INSERT OR IGNORE INTO role (person_id, activity_id, event_id, leadership_type, source) VALUES (` +
        `(SELECT id FROM person WHERE name = ${sql(r.person)} AND deleted_at IS NULL ORDER BY id LIMIT 1), ` +
        `(SELECT id FROM activity WHERE name = ${sql(r.activity)} AND deleted_at IS NULL ORDER BY id LIMIT 1), ` +
        `(SELECT id FROM event WHERE site_event_id = ${sql(r.event)}), ${sql(r.leadership_type)}, 'event_import');`
    );
  }
  writeFileSync(sqlOut, out.join('\n') + '\n');
  wroteSql = true;
}

// ---- Console summary (counts only: names stay in the review files) -----------
const count = (xs, f) => xs.reduce((m, x) => m.set(f(x), (m.get(f(x)) ?? 0) + 1), new Map());
const show = (m) => [...m].map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`Events: ${included.length} included. Skipped: ${show(count(skipped, (s) => s[1]))}.`);
console.log(`Event types: ${show(count(included, (e) => e.type))}`);
console.log(`Roles: ${roles.length} (${show(count(roles, (r) => r.leadership_type))})`);
console.log(
  `Activities: ${activities.size} (${[...activities.values()].filter((a) => a.existing).length} already in the sheet)`
);
console.log(`Types: ${show(count([...activities.values()], (a) => a.type))}`);
console.log(`People: ${people.size} led a class; ${newPeople.length} are new`);
console.log(
  `New people by status: ${show(count(newPeople, (p) => p.status || 'NEEDS YOUR CALL'))}; mentors ${newPeople.filter((p) => p.mentor).length}`
);
for (const c of checks) {
  console.log(
    `Cross-check ${c.slug}: sheet ${c.sheet} class roles, derived ${c.derived}; missing ${c.missingFromDerived.length}, extra ${c.extraInDerived.length}`
  );
}
for (const p of problems) console.log(`PROBLEM: ${p}`);
if (wroteSql) console.log(`Wrote ${sqlOut}`);
console.log(`Review files are in ${dir}`);

#!/usr/bin/env node
/**
 * Flag leader/staff bios that likely mention stale info (an age, a number of
 * years, "currently a college student", etc.) or simply haven't been touched
 * in a while.
 *
 * There's no `updatedAt`/`lastReviewed` field in the leader/staff schema, and
 * bio prose regularly embeds phrasing that quietly rots — "she is currently
 * a junior at..." stays in the copy for years after it stops being true, and
 * nothing ever surfaces that. This is a heuristic, advisory report (not a CI
 * gate): it flags candidates for a human to read and decide on, it does not
 * rewrite anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLLECTIONS = ['src/data/leaders', 'src/data/staff'];

const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
const STALE_DAYS = daysArg ? Number(daysArg.slice('--days='.length)) : 365;

const PATTERNS = [
  { label: 'age', regex: /\b\d{1,3}\s*[- ]?years?[- ]?old\b|\bage[d]?\s+\d{1,3}\b/gi },
  {
    label: 'years (experience/duration)',
    regex: /\b(\d{1,2}\+?|one|two|three|four|five|six|seven|eight|nine|ten)\s+years?\b(?!\s*[- ]?old)/gi,
  },
  {
    label: 'relative/temporal phrasing',
    regex: /\b(this past year|this year|last year|next year|recently|currently|soon)\b/gi,
  },
  {
    label: 'temporary status (school)',
    regex:
      /\b(in college|attending college|(high school|college|university)\s+(student|freshman|sophomore|junior|senior)|graduat(e|ing|ed))\b/gi,
  },
  { label: 'explicit year', regex: /\b(19|20)\d{2}\b/g },
];

function findBioFiles(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(full, name));
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return load(match[1]);
}

function lastModified(file) {
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%aI', '--', file], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    return iso ? new Date(iso) : null;
  } catch {
    return null;
  }
}

function snippet(text, index, length) {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + length + 20);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

function findMatches(bio) {
  const matches = [];
  for (const { label, regex } of PATTERNS) {
    for (const m of bio.matchAll(regex)) {
      matches.push({ label, snippet: snippet(bio, m.index, m[0].length) });
    }
  }
  return matches;
}

const files = COLLECTIONS.flatMap(findBioFiles).sort();
const results = [];

for (const file of files) {
  const frontmatter = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const bio = frontmatter?.bio;
  if (!bio) continue;

  const modified = lastModified(file);
  const daysAgo = modified ? Math.floor((Date.now() - modified.getTime()) / 86_400_000) : null;
  const matches = findMatches(bio);
  const stale = daysAgo === null || daysAgo >= STALE_DAYS;

  if (matches.length === 0 && !stale) continue;

  results.push({
    rel: path.relative(root, file),
    name: frontmatter.name ?? path.basename(file, '.md'),
    daysAgo,
    matches,
  });
}

results.sort((a, b) => (b.daysAgo ?? Infinity) - (a.daysAgo ?? Infinity));

if (results.length === 0) {
  console.log(`✓ 0 bio(s) flagged out of ${files.length} scanned`);
  process.exit(0);
}

console.log(`\n${results.length} bio(s) flagged for review (out of ${files.length} scanned):\n`);

for (const { rel, name, daysAgo, matches } of results) {
  const age = daysAgo === null ? 'no git history found' : `last updated ${daysAgo} day(s) ago`;
  console.log(`${name}  (${rel})`);
  console.log(`  ${age}`);
  for (const { label, snippet: text } of matches) {
    console.log(`  [${label}] ${text}`);
  }
  console.log('');
}

console.log(`✓ ${results.length} bio(s) flagged out of ${files.length} scanned`);

#!/usr/bin/env node
/**
 * Parse every YAML file in the repo and fail on anything malformed.
 *
 * The file this exists for is `public/admin/config.yml`. It is a static asset —
 * copied to dist/ verbatim and only ever parsed in the browser by Sveltia CMS —
 * so nothing in `astro build` looks at it. A syntax error (a duplicate `hint:`
 * key, a bad indent) therefore builds green, deploys, and breaks /admin for
 * content editors with no warning to anyone.
 *
 * js-yaml treats duplicate mapping keys as an error, which is the specific
 * failure mode this guards against.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAll } from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'test-results', '.astro']);

function findYamlFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...findYamlFiles(full));
    } else if (/\.ya?ml$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const files = findYamlFiles(root).sort();
const failures = [];

for (const file of files) {
  const rel = path.relative(root, file);
  try {
    // loadAll handles multi-document files (e.g. some CI configs).
    loadAll(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push({ rel, message: error.message });
  }
}

if (failures.length > 0) {
  console.error(`\n✖ ${failures.length} YAML file(s) failed to parse:\n`);
  for (const { rel, message } of failures) {
    console.error(`  ${rel}\n    ${message.split('\n').join('\n    ')}\n`);
  }
  process.exit(1);
}

console.log(`✓ ${files.length} YAML file(s) parsed cleanly`);

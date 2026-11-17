// Local-only review tool for the leadership history import. It serves one page
// and a small JSON API that edit the review files in the (private) export folder.
//
// Safety: it must only ever listen on 127.0.0.1, every request needs the random
// token, the Host and Origin headers are checked (against DNS rebinding and other
// sites), and clients can edit only named columns of rows that already exist.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { SKIP, STATUSES, TYPES, csv, norm, parseCsv } from './leadership-history.mjs';

const MAX_BODY = 1024 * 1024;
const here = path.dirname(new URL(import.meta.url).pathname);
export const PAGE = path.join(here, 'review-page.html');
const IMPORTER = path.join(here, '..', 'import-leadership-history.mjs');

class BadRequest extends Error {}

const readCsv = (dir, name) => {
  const p = path.join(dir, name);
  if (!existsSync(p)) return { header: [], rows: [] };
  const [header = [], ...rows] = parseCsv(readFileSync(p, 'utf8'));
  return { header, rows };
};

/** Write through a temp file so a crash cannot leave a half-written review file. */
const writeAtomic = (file, text) => {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
};
const writeCsv = (dir, name, header, rows) =>
  writeAtomic(path.join(dir, name), [header, ...rows].map((r) => r.map(csv).join(',')).join('\n') + '\n');

const readJson = (dir, name, fallback) => {
  const p = path.join(dir, name);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback;
};

const text = (v, field, max) => {
  if (typeof v !== 'string') throw new BadRequest(`${field} must be text`);
  if (v.length > max) throw new BadRequest(`${field} is too long`);
  return v.trim();
};

/**
 * Apply edits to the named columns of existing rows. `editable` maps a column to
 * a validator; rows are matched by their first column, and unknown rows are refused.
 */
export function applyEdits({ header, rows }, edits, editable) {
  if (!Array.isArray(edits) || edits.length > 5000) throw new BadRequest('edits must be a list');
  const index = new Map(rows.map((r) => [norm(r[0]), r]));
  for (const edit of edits) {
    const key = text(edit?.key, 'key', 500);
    const row = index.get(norm(key));
    if (!row) throw new BadRequest(`no such row: ${key}`);
    for (const [column, validate] of Object.entries(editable)) {
      if (!(column in edit)) continue;
      const at = header.indexOf(column);
      if (at === -1) throw new BadRequest(`no such column: ${column}`);
      row[at] = validate(edit[column]);
    }
  }
  return rows;
}

const oneOf = (allowed) => (v) => {
  const s = text(v, 'value', 100);
  if (!allowed.includes(s)) throw new BadRequest(`"${s}" is not one of: ${allowed.filter(Boolean).join(', ')}`);
  return s;
};
const free = (max) => (v) => text(v, 'value', max);

export const STATUS_COLUMNS = {
  status: oneOf(['', ...STATUSES]),
  mentor: oneOf(['', 'yes']),
  note: free(2000),
  basis: free(200),
};
export const TYPE_COLUMNS = { type: oneOf([...TYPES, SKIP]), basis: free(200) };

const pairKey = (a, b) => [norm(a), norm(b)].sort().join('|');

/** Everything the page needs. */
export function loadData(dir) {
  const status = readCsv(dir, 'history-status.csv');
  const types = readCsv(dir, 'history-types.csv');
  const decided = readJson(dir, 'history-duplicates-reviewed.json', {});
  const overrides = readJson(dir, 'history-name-overrides.json', {});
  const overridden = new Set(Object.keys(overrides).map(norm));
  const pairs = readCsv(dir, 'history-possible-duplicates.csv').rows.filter(
    ([a, b]) => !decided[pairKey(a, b)] && !overridden.has(norm(a)) && !overridden.has(norm(b))
  );
  const asObjects = ({ header, rows }) => rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
  return {
    people: asObjects(status),
    classes: asObjects(types),
    pairs,
    statuses: STATUSES,
    types: [...TYPES, SKIP],
  };
}

/** Run the importer as a dry run and return its summary. */
export const runImporter = (dir) =>
  new Promise((resolve) => {
    execFile(process.execPath, [IMPORTER, dir], { timeout: 60_000 }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout}${stderr}`.trim() });
    });
  });

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new BadRequest('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new BadRequest('body must be JSON'));
      }
    });
    req.on('error', reject);
  });

export function createReviewServer({ dir, token, run = runImporter }) {
  return createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return json(res, 403, { error: 'forbidden' });
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) return json(res, 403, { error: 'forbidden' });

      const url = new URL(req.url ?? '/', `http://${host}`);
      if (req.method === 'GET' && url.pathname === '/') {
        if (url.searchParams.get('t') !== token) return json(res, 403, { error: 'open the link the script printed' });
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'content-security-policy':
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
        });
        return res.end(readFileSync(PAGE));
      }
      if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
      if (req.headers['x-token'] !== token) return json(res, 403, { error: 'forbidden' });

      const route = `${req.method} ${url.pathname}`;
      if (route === 'GET /api/data') return json(res, 200, loadData(dir));

      if (route === 'PUT /api/status' || route === 'PUT /api/types') {
        const status = route.endsWith('status');
        const file = status ? 'history-status.csv' : 'history-types.csv';
        const table = readCsv(dir, file);
        const body = await readBody(req);
        const rows = applyEdits(table, body.edits, status ? STATUS_COLUMNS : TYPE_COLUMNS);
        writeCsv(dir, file, table.header, rows);
        return json(res, 200, { ok: true });
      }

      if (route === 'POST /api/merge') {
        const { from, into } = await readBody(req);
        const a = text(from, 'from', 200);
        const b = text(into, 'into', 200);
        if (!a || !b || norm(a) === norm(b)) throw new BadRequest('pick two different names');
        const overrides = readJson(dir, 'history-name-overrides.json', {});
        writeAtomic(
          path.join(dir, 'history-name-overrides.json'),
          JSON.stringify({ ...overrides, [a]: b }, null, 2) + '\n'
        );
        return json(res, 200, { ok: true });
      }

      if (route === 'POST /api/different') {
        const { a, b } = await readBody(req);
        const decided = readJson(dir, 'history-duplicates-reviewed.json', {});
        decided[pairKey(text(a, 'a', 200), text(b, 'b', 200))] = 'different';
        writeAtomic(path.join(dir, 'history-duplicates-reviewed.json'), JSON.stringify(decided, null, 2) + '\n');
        return json(res, 200, { ok: true });
      }

      if (route === 'POST /api/check') return json(res, 200, await run(dir));

      return json(res, 404, { error: 'not found' });
    } catch (err) {
      if (err instanceof BadRequest) return json(res, 400, { error: err.message });
      console.error(err);
      return json(res, 500, { error: 'server error' });
    }
  });
}

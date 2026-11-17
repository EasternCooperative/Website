import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyEdits, createReviewServer, loadData } from '../../scripts/lib/review-server.mjs';

const TOKEN = 'test-token';
let dir: string;
let server: http.Server;
let base: string;
let runs: string[];

// Placeholder names only.
const STATUS = [
  'name,status,mentor,note,basis,events,roles,first year,last year',
  'Person A,,,,led 2025: your call,2,3,2020,2025',
  'Person B,hiatus,,,"led 3 times, last in 2014",3,3,2010,2014',
  '"Person, C",inactive,yes,"said ""hi""",led once,1,1,2009,2009',
].join('\n');
const TYPES = [
  'class,type,subtype,basis,times,last year',
  'Felting,Crafts,,proposed: review,1,2024',
  'Break,SKIP,,"proposed: not a class, drops out",2,2023',
  'Ukulele,Music,Instruments,rule: ukulele,9,2025',
].join('\n');
const DUPES = ['a,b', 'Pat Lee,Patricia Lee', 'Sam Roe,Samuel Roe'].join('\n');

const read = (name: string) => readFileSync(path.join(dir, name), 'utf8');
const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = { 'x-token': TOKEN }) =>
  fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'review-'));
  writeFileSync(path.join(dir, 'history-status.csv'), STATUS + '\n');
  writeFileSync(path.join(dir, 'history-types.csv'), TYPES + '\n');
  writeFileSync(path.join(dir, 'history-possible-duplicates.csv'), DUPES + '\n');
  runs = [];
  server = createReviewServer({
    dir,
    token: TOKEN,
    run: async (d: string) => {
      runs.push(d);
      return { ok: true, output: 'summary line' };
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

describe('access', () => {
  it('serves the page only with the token, with a locked-down CSP', async () => {
    expect((await fetch(base + '/')).status).toBe(403);
    expect((await fetch(base + '/?t=wrong')).status).toBe(403);
    const ok = await fetch(base + `/?t=${TOKEN}`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('Leadership history review');
    expect(ok.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(ok.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses the API without the right token', async () => {
    expect((await call('GET', '/api/data', undefined, {})).status).toBe(403);
    expect((await call('GET', '/api/data', undefined, { 'x-token': 'nope' })).status).toBe(403);
    expect((await call('GET', '/api/data')).status).toBe(200);
  });

  it('refuses a foreign Origin, so another website cannot drive it', async () => {
    const res = await call('PUT', '/api/status', { edits: [] }, { 'x-token': TOKEN, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });

  it('refuses an unexpected Host header (DNS rebinding)', async () => {
    const port = (server.address() as AddressInfo).port;
    const status = await new Promise<number>((resolve) => {
      http
        .request(
          { host: '127.0.0.1', port, path: '/api/data', headers: { host: 'evil.example', 'x-token': TOKEN } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          }
        )
        .end();
    });
    expect(status).toBe(403);
  });

  it('404s unknown routes', async () => {
    expect((await call('GET', '/nope')).status).toBe(404);
    expect((await call('GET', '/api/nope')).status).toBe(404);
  });
});

describe('reading', () => {
  it('returns people, classes, pairs, and the allowed values', async () => {
    const data = await (await call('GET', '/api/data')).json();
    expect(data.people.map((p: { name: string }) => p.name)).toEqual(['Person A', 'Person B', 'Person, C']);
    expect(data.people[2]).toMatchObject({ status: 'inactive', mentor: 'yes', note: 'said "hi"' });
    expect(data.classes).toHaveLength(3);
    expect(data.pairs).toHaveLength(2);
    expect(data.statuses).toEqual(['active', 'hiatus', 'inactive']);
    expect(data.types).toContain('SKIP');
    expect(data.types).toContain('Music');
    expect(data.types).not.toContain('Singing');
    expect(data.classes[2]).toMatchObject({ type: 'Music', subtype: 'Instruments' });
  });

  it('copes with missing files', () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'review-empty-'));
    expect(loadData(empty)).toMatchObject({ people: [], classes: [], pairs: [] });
    rmSync(empty, { recursive: true });
  });
});

describe('editing', () => {
  it('changes only the named columns, and keeps commas and quotes intact', async () => {
    const res = await call('PUT', '/api/status', {
      edits: [
        { key: 'Person A', status: 'active', basis: 'you', mentor: 'yes' },
        { key: 'person, c', note: 'retired, 2024 "quietly"' },
      ],
    });
    expect(res.status).toBe(200);
    const data = await (await call('GET', '/api/data')).json();
    expect(data.people[0]).toMatchObject({
      name: 'Person A',
      status: 'active',
      basis: 'you',
      mentor: 'yes',
      events: '2',
      roles: '3',
    });
    expect(data.people[2]).toMatchObject({ status: 'inactive', mentor: 'yes', note: 'retired, 2024 "quietly"' });
    expect(data.people[1].status).toBe('hiatus'); // untouched
  });

  it('accepts a class type including SKIP', async () => {
    await call('PUT', '/api/types', { edits: [{ key: 'Felting', type: 'SKIP', basis: 'you' }] });
    const data = await (await call('GET', '/api/data')).json();
    expect(data.classes[0]).toMatchObject({ type: 'SKIP', basis: 'you' });
  });

  it('saves a type together with a subtype', async () => {
    await call('PUT', '/api/types', { edits: [{ key: 'Felting', type: 'Music', subtype: 'Rhythm', basis: 'you' }] });
    const data = await (await call('GET', '/api/data')).json();
    expect(data.classes[0]).toMatchObject({ type: 'Music', subtype: 'Rhythm', basis: 'you' });
  });

  it.each([
    ['an unknown status', '/api/status', { edits: [{ key: 'Person A', status: 'dead' }] }],
    ['a retired status', '/api/status', { edits: [{ key: 'Person A', status: 'mentor' }] }],
    ['a bad mentor value', '/api/status', { edits: [{ key: 'Person A', mentor: 'maybe' }] }],
    ['an unknown row', '/api/status', { edits: [{ key: 'Nobody', status: 'active' }] }],
    ['an unknown type', '/api/types', { edits: [{ key: 'Felting', type: 'Singing' }] }],
    ['a huge subtype', '/api/types', { edits: [{ key: 'Felting', subtype: 'x'.repeat(100) }] }],
    ['edits that are not a list', '/api/status', { edits: 'all' }],
    ['a non-text value', '/api/status', { edits: [{ key: 'Person A', note: 5 }] }],
    ['a huge note', '/api/status', { edits: [{ key: 'Person A', note: 'x'.repeat(3000) }] }],
  ])('rejects %s and leaves the file alone', async (_name, url, body) => {
    const before = read(url.endsWith('status') ? 'history-status.csv' : 'history-types.csv');
    expect((await call('PUT', url, body)).status).toBe(400);
    expect(read(url.endsWith('status') ? 'history-status.csv' : 'history-types.csv')).toBe(before);
  });

  it('ignores columns that are not editable, so history numbers cannot change', async () => {
    await call('PUT', '/api/status', { edits: [{ key: 'Person A', events: '99', 'last year': '1900' }] });
    const data = await (await call('GET', '/api/data')).json();
    expect(data.people[0]).toMatchObject({ events: '2', 'last year': '2025' });
  });

  it('rejects a body that is not JSON', async () => {
    const res = await fetch(base + '/api/status', { method: 'PUT', headers: { 'x-token': TOKEN }, body: 'not json' });
    expect(res.status).toBe(400);
  });

  it('rejects a body that is too large', async () => {
    const res = await fetch(base + '/api/status', {
      method: 'PUT',
      headers: { 'x-token': TOKEN },
      body: JSON.stringify({ edits: [], pad: 'x'.repeat(1024 * 1024 + 10) }),
    }).catch(() => null);
    // The server may cut the connection once the limit is passed, which is also a refusal.
    expect(res === null || res.status === 400).toBe(true);
  });
});

describe('duplicates', () => {
  it('records a merge in the overrides file, keeping existing entries, and hides the pair', async () => {
    writeFileSync(path.join(dir, 'history-name-overrides.json'), JSON.stringify({ 'Old Name': 'Person A' }));
    expect((await call('POST', '/api/merge', { from: 'Patricia Lee', into: 'Pat Lee' })).status).toBe(200);
    expect(JSON.parse(read('history-name-overrides.json'))).toEqual({
      'Old Name': 'Person A',
      'Patricia Lee': 'Pat Lee',
    });
    const data = await (await call('GET', '/api/data')).json();
    expect(data.pairs).toEqual([['Sam Roe', 'Samuel Roe']]);
  });

  it('refuses to merge a name into itself or with blanks', async () => {
    expect((await call('POST', '/api/merge', { from: 'Pat Lee', into: 'pat  lee' })).status).toBe(400);
    expect((await call('POST', '/api/merge', { from: '', into: 'Pat Lee' })).status).toBe(400);
    expect((await call('POST', '/api/merge', { from: 5, into: 'Pat Lee' })).status).toBe(400);
  });

  it('remembers a "different people" decision either way round', async () => {
    expect((await call('POST', '/api/different', { a: 'Samuel Roe', b: 'Sam Roe' })).status).toBe(200);
    const data = await (await call('GET', '/api/data')).json();
    expect(data.pairs).toEqual([['Pat Lee', 'Patricia Lee']]);
    expect(JSON.parse(read('history-duplicates-reviewed.json'))).toEqual({ 'sam roe|samuel roe': 'different' });
  });
});

describe('check', () => {
  it('runs the importer on the folder and returns its summary', async () => {
    const out = await (await call('POST', '/api/check')).json();
    expect(out).toEqual({ ok: true, output: 'summary line' });
    expect(runs).toEqual([dir]);
  });
});

describe('applyEdits', () => {
  it('skips columns an edit does not mention, and refuses a missing column', () => {
    const table = { header: ['name', 'status'], rows: [['A', '']] };
    expect(applyEdits(table, [{ key: 'A' }], { status: (v: string) => v })).toEqual([['A', '']]);
    expect(() => applyEdits(table, [{ key: 'A', mentor: 'yes' }], { mentor: (v: string) => v })).toThrow(
      'no such column'
    );
  });
});

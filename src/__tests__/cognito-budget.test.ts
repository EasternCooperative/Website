import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeBudget } from '../../scripts/lib/cognito-budget.mjs';
import { makeGet } from '../../scripts/lib/cognito-api.mjs';

const dir = () => mkdtempSync(path.join(os.tmpdir(), 'budget-'));
const at = (iso: string) => () => new Date(iso);

describe('the Cognito request budget', () => {
  it('counts each request in a ledger that carries between runs', () => {
    const file = path.join(dir(), 'usage.json');
    const a = makeBudget({ file, env: {}, now: at('2026-11-20T12:00:00Z') });
    a.spend();
    a.spend();
    expect(a.used).toEqual({ run: 2, month: 2 });
    const b = makeBudget({ file, env: {}, now: at('2026-11-21T12:00:00Z') });
    b.spend();
    expect(b.used).toEqual({ run: 1, month: 3 });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ month: '2026-11', count: 3 });
  });

  it('starts a fresh count in a new month, and copes with a missing or damaged ledger', () => {
    const file = path.join(dir(), 'usage.json');
    makeBudget({ file, env: {}, now: at('2026-11-20T12:00:00Z') }).spend();
    expect(makeBudget({ file, env: {}, now: at('2026-12-01T00:00:00Z') }).used.month).toBe(0);
    writeFileSync(file, 'not json');
    expect(makeBudget({ file, env: {} }).used.month).toBe(0);
  });

  it('stops a run before it passes its limit, and says how to allow more', () => {
    const b = makeBudget({ file: path.join(dir(), 'u.json'), env: { COGNITO_MAX_REQUESTS: '2' } });
    b.spend();
    b.spend();
    expect(() => b.spend()).toThrow(/this run has made 2 Cognito requests \(limit 2\).*COGNITO_MAX_REQUESTS/);
    expect(b.used.run).toBe(2);
  });

  it('stops across runs when the month is used up', () => {
    const file = path.join(dir(), 'u.json');
    const env = { COGNITO_MONTH_CAP: '3' };
    const a = makeBudget({ file, env });
    a.spend();
    a.spend();
    a.spend();
    expect(() => makeBudget({ file, env }).spend()).toThrow(/3 Cognito requests recorded this month \(cap 3\)/);
  });

  it('defaults to 300 a run and 6,000 a month', () => {
    const b = makeBudget({ file: path.join(dir(), 'u.json'), env: {} });
    for (let i = 0; i < 300; i++) b.spend();
    expect(() => b.spend()).toThrow(/limit 300/);
    const file = path.join(dir(), 'm.json');
    writeFileSync(file, JSON.stringify({ month: new Date().toISOString().slice(0, 7), count: 6000 }));
    expect(() => makeBudget({ file, env: {} }).spend()).toThrow(/cap 6000/);
  });

  it('counts every attempt in the request helper, retries included, and never makes a request it cannot afford', async () => {
    let calls = 0;
    const answers = [new Response('{}', { status: 429 }), new Response('{"ok":1}')];
    const budget = makeBudget({ file: path.join(dir(), 'u.json'), env: { COGNITO_MAX_REQUESTS: '2' } });
    const get = makeGet('k', {
      budget,
      wait: async () => {},
      fetchImpl: (async () => {
        calls++;
        return answers.shift();
      }) as never,
    });
    expect(await get('/x')).toEqual({ ok: 1 });
    expect(budget.used.run).toBe(2);
    await expect(get('/y')).rejects.toThrow(/Stopped/);
    expect(calls).toBe(2);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/internal/leadership/[[path]].js';
import { ValidationError, bulkAddRoles, validators } from '../../functions/_lib/leadership.js';

/** Minimal D1 stub that records prepared SQL and bound params. */
function fakeDb(handlers: { all?: (sql: string) => unknown[]; run?: (sql: string) => Record<string, number> } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const prepare = (sql: string) => {
    const stmt = {
      params: [] as unknown[],
      bind(...p: unknown[]) {
        stmt.params = p;
        return stmt;
      },
      async all() {
        calls.push({ sql, params: stmt.params });
        return { results: handlers.all?.(sql) ?? [] };
      },
      async run() {
        calls.push({ sql, params: stmt.params });
        return { meta: { last_row_id: 7, changes: 1, ...handlers.run?.(sql) } };
      },
    };
    return stmt;
  };
  return { calls, prepare, batch: async (stmts: unknown[]) => stmts.map(() => ({ meta: { changes: 1 } })) };
}

const dev = { DEV_AUTH_EMAIL: 'board@example.org' };
const call = (path: string[], init: RequestInit = {}, env: Record<string, unknown> = {}, headers: HeadersInit = {}) =>
  onRequest({
    request: new Request(`http://localhost:8788/api/internal/leadership/${path.join('/')}`, {
      ...init,
      headers: { origin: 'http://localhost:8788', ...headers },
    }),
    env,
    params: { path },
  } as never);

describe('leadership API gate', () => {
  it('refuses unauthenticated requests before touching the database', async () => {
    const db = fakeDb();
    const res = await onRequest({
      request: new Request('https://ecrs.org/api/internal/leadership/bootstrap'),
      env: { DB: db },
      params: { path: ['bootstrap'] },
    } as never);
    expect(res.status).toBe(503); // Access not configured: fails closed
    expect(db.calls).toHaveLength(0);
  });

  it('refuses cross-origin writes', async () => {
    const res = await call(
      ['person'],
      { method: 'POST', body: '{}' },
      { ...dev, DB: fakeDb() },
      { origin: 'https://evil.example' }
    );
    expect(res.status).toBe(403);
  });

  it('is no-store and returns bootstrap data', async () => {
    const db = fakeDb({ all: (sql) => (sql.includes('activity_type') ? [{ name: 'Games' }] : []) });
    const res = await call(['bootstrap'], {}, { ...dev, DB: db });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.me).toBe('board@example.org');
    expect(body.activityTypes).toEqual(['Games']);
  });
});

describe('leadership API writes', () => {
  it('creates a person with parameterized SQL', async () => {
    const db = fakeDb();
    const res = await call(
      ['person'],
      { method: 'POST', body: JSON.stringify({ name: "x'); DROP TABLE person;--" }) },
      { ...dev, DB: db }
    );
    expect(res.status).toBe(201);
    const insert = db.calls.find((c) => c.sql.startsWith('INSERT INTO person'))!;
    expect(insert.sql).not.toContain('DROP');
    expect(insert.params[0]).toContain('DROP TABLE');
  });

  it('stamps the note author from the Access identity, not the body', async () => {
    const db = fakeDb();
    await call(
      ['note'],
      {
        method: 'POST',
        body: JSON.stringify({ person_id: 1, body: 'Ready for more', kind: 'ready', author: 'spoof@x.org' }),
      },
      { ...dev, DB: db }
    );
    const insert = db.calls.find((c) => c.sql.startsWith('INSERT INTO journey_note'))!;
    expect(insert.params).toContain('board@example.org');
    expect(insert.params).not.toContain('spoof@x.org');
  });

  it('400s on invalid input and 404s on unknown routes', async () => {
    const env = { ...dev, DB: fakeDb() };
    expect((await call(['person'], { method: 'POST', body: '{"status":"nope","name":"A"}' }, env)).status).toBe(400);
    expect((await call(['person'], { method: 'POST', body: 'not json' }, env)).status).toBe(400);
    expect((await call(['bogus'], { method: 'POST', body: '{}' }, env)).status).toBe(404);
    expect((await call(['person', 'abc'], { method: 'DELETE' }, env)).status).toBe(404);
  });

  it('maps a unique violation to 409', async () => {
    const db = fakeDb();
    vi.spyOn(db, 'prepare').mockImplementation(() => {
      throw new Error('UNIQUE constraint failed: role.person_id');
    });
    const body = JSON.stringify({ person_id: 1, activity_id: 1, event_id: 1, leadership_type: 'solo' });
    expect((await call(['role'], { method: 'POST', body }, { ...dev, DB: db })).status).toBe(409);
  });

  it('soft-deletes instead of deleting', async () => {
    const db = fakeDb();
    const res = await call(['role', '5'], { method: 'DELETE' }, { ...dev, DB: db });
    expect(res.status).toBe(200);
    expect(db.calls[0].sql).toMatch(/^UPDATE role SET deleted_at/);
  });
});

describe('validators and bulk add', () => {
  it('rejects bad enums', () => {
    expect(() => validators.role({ person_id: 1, activity_id: 1, event_id: 1, leadership_type: 'boss' })).toThrow(
      ValidationError
    );
    expect(() => validators.event({ name: 'x', event_type: 'extended', year: 1800 })).toThrow(ValidationError);
  });

  it('bulk-adds and bounds the batch size', async () => {
    const rows = [{ person_id: 1, activity_id: 2, event_id: 3, leadership_type: 'solo' }];
    expect(await bulkAddRoles(fakeDb(), rows)).toBe(1);
    await expect(bulkAddRoles(fakeDb(), [])).rejects.toThrow(ValidationError);
    await expect(bulkAddRoles(fakeDb(), Array(201).fill(rows[0]))).rejects.toThrow(ValidationError);
  });
});

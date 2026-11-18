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

describe('leadership API audit trail', () => {
  const as = { ...dev };

  it('stamps created_by and updated_by from the Access identity, not the body', async () => {
    const db = fakeDb();
    await call(
      ['person'],
      { method: 'POST', body: JSON.stringify({ name: 'Person A', created_by: 'spoof@x.org' }) },
      { ...as, DB: db }
    );
    const { sql, params } = db.calls[0];
    expect(sql).toContain('created_by, updated_by');
    expect(params.slice(-2)).toEqual(['board@example.org', 'board@example.org']);
  });

  it('stamps updated_by on edits and removals, but never touches created_by', async () => {
    const db = fakeDb();
    await call(['person', '3'], { method: 'PUT', body: '{"name":"Person A"}' }, { ...as, DB: db });
    expect(db.calls[0].sql).toContain('updated_by = ?');
    expect(db.calls[0].sql).not.toContain('created_by');
    expect(db.calls[0].params.slice(-2)).toEqual(['board@example.org', 3]);

    const del = fakeDb();
    await call(['role', '5'], { method: 'DELETE' }, { ...as, DB: del });
    expect(del.calls[0].sql).toContain('updated_by = ?');
    expect(del.calls[0].params).toEqual(['board@example.org', 5]);
  });

  it('stamps bulk-added roles, and leaves notes on their own author column', async () => {
    const stmts: unknown[][] = [];
    const db = fakeDb();
    const prepare = db.prepare;
    db.prepare = (sql: string) => {
      const st = prepare(sql);
      const bind = st.bind.bind(st);
      st.bind = (...p: unknown[]) => (stmts.push(p), bind(...p));
      return st;
    };
    await bulkAddRoles(db, [{ person_id: 1, activity_id: 2, event_id: 3, leadership_type: 'solo' }], 'a@x.org');
    expect(stmts[0].slice(-2)).toEqual(['a@x.org', 'a@x.org']);

    const notes = fakeDb();
    await call(['note', '2'], { method: 'DELETE' }, { ...as, DB: notes });
    expect(notes.calls[0].sql).not.toContain('updated_by');
    expect(notes.calls[0].params).toEqual([2]);
  });
});

describe('leadership API guards', () => {
  const activity = JSON.stringify({ name: 'Tag', scope: 'activity', type: 'Games' });

  it('refuses to remove a person, activity, or event that still has roles', async () => {
    const db = fakeDb({ all: (sql) => (sql.includes('FROM role') ? [{ id: 1 }, { id: 2 }] : []) });
    const res = await call(['activity', '3'], { method: 'DELETE' }, { ...dev, DB: db });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('It still has 2 roles. Remove them first.');
    expect(db.calls.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);

    const one = fakeDb({ all: (sql) => (sql.includes('FROM role') ? [{ id: 1 }] : []) });
    const res1 = await call(['event', '3'], { method: 'DELETE' }, { ...dev, DB: one });
    expect((await res1.json()).error).toBe('It still has 1 role. Remove it first.');
  });

  it('removes an activity once it has no roles, and checks the right column', async () => {
    const db = fakeDb();
    expect((await call(['person', '4'], { method: 'DELETE' }, { ...dev, DB: db })).status).toBe(200);
    expect(db.calls[0].sql).toContain('person_id = ?');
    expect(db.calls[0].params).toEqual([4]);
  });

  it('rejects a duplicate activity or event, on create and on rename, but not itself', async () => {
    const dup = fakeDb({ all: (sql) => (sql.includes('lower(name)') ? [{ id: 9 }] : []) });
    expect((await call(['activity'], { method: 'POST', body: activity }, { ...dev, DB: dup })).status).toBe(409);
    expect((await call(['activity', '2'], { method: 'PUT', body: activity }, { ...dev, DB: dup })).status).toBe(409);
    const ev = JSON.stringify({ name: 'Camp', event_type: 'weekend', year: 2025 });
    expect((await call(['event'], { method: 'POST', body: ev }, { ...dev, DB: dup })).status).toBe(409);

    const clean = fakeDb();
    expect((await call(['activity', '2'], { method: 'PUT', body: activity }, { ...dev, DB: clean })).status).toBe(200);
    expect(clean.calls[0].params).toEqual(['Tag', 'activity', 2]); // excludes its own id
  });

  it('does not check people for duplicates', async () => {
    const db = fakeDb({ all: () => [{ id: 9 }] });
    const res = await call(['person'], { method: 'POST', body: '{"name":"Person A"}' }, { ...dev, DB: db });
    expect(res.status).toBe(201);
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

describe('person availability', () => {
  it('accepts the three leading statuses', () => {
    for (const status of ['active', 'hiatus', 'inactive']) {
      expect(validators.person({ name: 'Person A', status }).status).toBe(status);
    }
    expect(validators.person({ name: 'Person A' }).status).toBe('active');
  });

  it('rejects the retired statuses, since mentoring is a separate flag now', () => {
    for (const status of ['mentor', 'do_not_ask']) {
      expect(() => validators.person({ name: 'Person A', status })).toThrow(ValidationError);
    }
  });

  it('reads mentor as yes or no, and defaults to no', () => {
    const mentor = (v: unknown) => validators.person({ name: 'Person A', mentor: v }).mentor;
    expect([mentor(true), mentor(1), mentor(false), mentor(0), mentor(undefined), mentor(null)]).toEqual([
      1, 1, 0, 0, 0, 0,
    ]);
    expect(() => mentor('yes')).toThrow(ValidationError);
    expect(() => mentor(2)).toThrow(ValidationError);
  });

  it('saves the mentor flag with the person', async () => {
    const db = fakeDb();
    const res = await call(
      ['person', '3'],
      { method: 'PUT', body: JSON.stringify({ name: 'Person A', status: 'inactive', mentor: true }) },
      { ...dev, DB: db }
    );
    expect(res.status).toBe(200);
    const update = db.calls.find((c) => c.sql.startsWith('UPDATE person SET'))!;
    expect(update.sql).toContain('mentor = ?');
    expect(update.params).toContain(1);
    expect(update.params).toContain('inactive');
  });
});

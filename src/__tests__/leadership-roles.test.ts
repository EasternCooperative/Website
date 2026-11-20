import { beforeEach, describe, expect, it, vi } from 'vitest';

// Sign in as whoever the test says, so the permission checks run for real.
let signedInAs = 'user@example.org';
vi.mock('../../functions/_lib/access.js', async (orig) => {
  const real = await orig<typeof import('../../functions/_lib/access.js')>();
  return { ...real, authenticate: async () => ({ email: signedInAs }) };
});

import { onRequest } from '../../functions/api/internal/leadership/[[path]].js';
import { resolveUser, validateUser } from '../../functions/_lib/roles.js';

type Row = Record<string, unknown>;

/** D1 stub backed by an in-memory access list, so lookups and writes behave. */
function fakeDb(users: Row[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const prepare = (sql: string) => {
    const st = {
      params: [] as unknown[],
      bind(...p: unknown[]) {
        st.params = p;
        return st;
      },
      async all() {
        calls.push({ sql, params: st.params });
        if (sql.includes('FROM app_user WHERE email_lower')) {
          return { results: users.filter((u) => u.email_lower === st.params[0]) };
        }
        if (sql.includes('FROM app_user')) return { results: users.map((u) => ({ ...u, email: u.email_lower })) };
        return { results: [] };
      },
      async run() {
        calls.push({ sql, params: st.params });
        return { meta: { last_row_id: 1, changes: 1 } };
      },
    };
    return st;
  };
  return { calls, prepare, batch: async () => [] };
}

const admin = { email_lower: 'admin@example.org', level: 'standard', is_admin: 1 };
const treasurer = { email_lower: 'treasurer@example.org', level: 'finance', is_admin: 0 };
const member = { email_lower: 'user@example.org', level: 'standard', is_admin: 0 };

const call = (path: string[], db: ReturnType<typeof fakeDb>, init: RequestInit = {}) =>
  onRequest({
    request: new Request(`https://ecrs.org/api/internal/leadership/${path.join('/')}`, {
      ...init,
      headers: { origin: 'https://ecrs.org' },
    }),
    env: { DB: db },
    params: { path },
  } as never);

beforeEach(() => {
  signedInAs = 'user@example.org';
});

describe('the access list', () => {
  it('refuses someone who passed Access but is not listed, before reading any data', async () => {
    const db = fakeDb([admin]);
    for (const path of [['bootstrap'], ['export'], ['person']]) {
      const res = await call(path, db, path[0] === 'person' ? { method: 'POST', body: '{"name":"x"}' } : {});
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain('Ask an admin');
    }
    expect(db.calls.every((c) => c.sql.includes('app_user'))).toBe(true);
  });

  it('refuses someone who was removed', async () => {
    const db = fakeDb([]); // the lookup ignores removed rows
    expect((await call(['bootstrap'], db)).status).toBe(403);
  });

  it('tells the page who is signed in and what they may do', async () => {
    signedInAs = 'Treasurer@Example.org';
    const res = await call(['bootstrap'], fakeDb([treasurer]));
    const body = await res.json();
    expect(body).toMatchObject({ me: 'Treasurer@Example.org', level: 'finance', isAdmin: false });
  });

  it('records exports', async () => {
    const db = fakeDb([member]);
    await call(['export'], db);
    const logged = db.calls.find((c) => c.sql.includes('INSERT INTO audit_log'));
    expect(logged?.params).toEqual(['user@example.org', 'export', null, null]);
  });
});

describe('managing the access list', () => {
  it('is for admins only', async () => {
    const db = fakeDb([member]);
    for (const [path, init] of [
      [['users'], {}],
      [['users'], { method: 'POST', body: '{"email":"a@b.org","level":"standard"}' }],
      [['users', 'a@b.org'], { method: 'PUT', body: '{"level":"finance"}' }],
      [['users', 'a@b.org'], { method: 'DELETE' }],
    ] as const) {
      expect((await call([...path], db, init as RequestInit)).status).toBe(403);
    }
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO app_user'))).toBe(false);
  });

  it('lists, adds, changes, and removes, recording who did it', async () => {
    signedInAs = 'admin@example.org';
    const db = fakeDb([admin]);
    expect((await (await call(['users'], db)).json()).users).toHaveLength(1);

    expect(
      (
        await call(['users'], db, {
          method: 'POST',
          body: '{"email":" New@Example.org ","level":"finance","is_admin":true}',
        })
      ).status
    ).toBe(200);
    const add = db.calls.find((c) => c.sql.includes('INSERT INTO app_user'))!;
    expect(add.params).toEqual(['new@example.org', 'finance', 1, 'admin@example.org', 'admin@example.org']);

    expect(
      (await call(['users', 'new%40example.org'], db, { method: 'PUT', body: '{"level":"standard"}' })).status
    ).toBe(200);
    expect(
      db.calls
        .filter((c) => c.sql.includes('INSERT INTO app_user'))
        .pop()!
        .params.slice(0, 3)
    ).toEqual(['new@example.org', 'standard', 0]);

    expect((await call(['users', 'new@example.org'], db, { method: 'DELETE' })).status).toBe(200);
    const log = db.calls.filter((c) => c.sql.includes('INSERT INTO audit_log')).map((c) => c.params.slice(1, 3));
    expect(log).toEqual([
      ['user.save', 'new@example.org'],
      ['user.save', 'new@example.org'],
      ['user.remove', 'new@example.org'],
    ]);
  });

  it('never lets anyone change or remove their own access', async () => {
    signedInAs = 'admin@example.org';
    const db = fakeDb([admin]);
    const own = '{"email":"ADMIN@example.org","level":"finance","is_admin":true}';
    const res = await call(['users'], db, { method: 'POST', body: own });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('You can’t change your own access.');
    expect((await call(['users', 'admin@example.org'], db, { method: 'DELETE' })).status).toBe(400);
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO app_user') || c.sql.startsWith('UPDATE app_user'))).toBe(
      false
    );
  });

  it('validates the email and level, and 404s on removing someone who is not there', async () => {
    signedInAs = 'admin@example.org';
    const db = fakeDb([admin]);
    expect((await call(['users'], db, { method: 'POST', body: '{"email":"nope","level":"finance"}' })).status).toBe(
      400
    );
    expect((await call(['users'], db, { method: 'POST', body: '{"email":"a@b.org","level":"boss"}' })).status).toBe(
      400
    );
    expect((await call(['users'], db, { method: 'PATCH' })).status).toBe(405);
    const none = fakeDb([admin]);
    const run = none.prepare;
    none.prepare = (sql: string) => {
      const st = run(sql);
      st.run = async () => ({ meta: { last_row_id: 0, changes: 0 } });
      return st;
    };
    expect((await call(['users', 'ghost@example.org'], none, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('protected owners', () => {
  const owner = { email_lower: 'owner@example.org', level: 'finance', is_admin: 1, protected: 1 };

  it('cannot be changed or removed by another admin', async () => {
    signedInAs = 'admin@example.org';
    const db = fakeDb([admin, owner]);
    const change = await call(['users'], db, {
      method: 'POST',
      body: '{"email":"owner@example.org","level":"standard"}',
    });
    expect(change.status).toBe(400);
    expect((await change.json()).error).toBe('This person’s access is protected. It can’t be changed or removed.');
    expect((await call(['users', 'owner@example.org'], db, { method: 'DELETE' })).status).toBe(400);
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO app_user') || c.sql.startsWith('UPDATE app_user'))).toBe(
      false
    );
  });

  it('does not stop changes to people who are not protected', async () => {
    signedInAs = 'admin@example.org';
    const db = fakeDb([admin, treasurer]);
    expect((await call(['users', 'treasurer@example.org'], db, { method: 'DELETE' })).status).toBe(200);
  });
});

describe('roles helpers', () => {
  it('treats local development as a full admin, and everyone else by their row', async () => {
    const db = fakeDb([treasurer]);
    expect(await resolveUser(db, { email: 'dev@localhost', dev: true })).toMatchObject({
      level: 'finance',
      is_admin: 1,
    });
    expect(await resolveUser(db, { email: 'TREASURER@example.org' })).toEqual({
      email: 'treasurer@example.org',
      level: 'finance',
      is_admin: 0,
    });
    expect(await resolveUser(db, { email: 'stranger@example.org' })).toBeNull();
  });

  it('checks the new person’s details', () => {
    expect(validateUser({ email: ' A@B.org ', level: 'standard' })).toEqual({
      email: 'a@b.org',
      level: 'standard',
      is_admin: 0,
    });
    expect(() => validateUser({ email: 'a@b.org', level: 'standard', is_admin: 'yes' })).toThrow();
    expect(() => validateUser({ level: 'standard' })).toThrow();
  });
});

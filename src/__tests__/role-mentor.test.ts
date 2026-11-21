// A role can name who mentored it at that event. Against real SQLite.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteD1 } from './d1-sqlite';

vi.mock('../../functions/_lib/access.js', async (orig) => {
  const real = await orig<typeof import('../../functions/_lib/access.js')>();
  return { ...real, authenticate: async () => ({ email: 'admin@example.org' }) };
});
import { onRequest } from '../../functions/api/internal/leadership/[[path]].js';

let db: ReturnType<typeof sqliteD1>;
const call = (path: string, method = 'GET', body?: unknown) =>
  onRequest({
    request: new Request(`https://ecrs.org/api/internal/leadership/${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { origin: 'https://ecrs.org' },
    }),
    env: { DB: db.d1 },
    params: { path: path.split('/') },
  } as never);
const mentorOf = (roleId: number) =>
  (db.raw.prepare('SELECT mentor_id FROM role WHERE id = ?').get(roleId) as { mentor_id: number | null }).mentor_id;
const base = { person_id: 1, activity_id: 1, event_id: 1, leadership_type: 'assisting' };

beforeEach(() => {
  db = sqliteD1();
  db.raw.exec(`
    INSERT INTO app_user (email_lower, level, is_admin) VALUES ('admin@example.org', 'standard', 1);
    INSERT INTO person (id, name, status, mentor) VALUES (1, 'New Leader', 'active', 0), (2, 'Old Hand', 'active', 1), (3, 'Other Hand', 'active', 1);
    INSERT INTO event (id, name, event_type, year) VALUES (1, 'Camp 2025', 'weekend', 2025);
    INSERT INTO activity (id, name, scope, type) VALUES (1, 'Tag', 'activity', 'Games');
  `);
});

describe('role mentor', () => {
  it('is saved, shown in the data, and kept when an older client saves without it', async () => {
    const res = await call('role', 'POST', { ...base, mentor_id: 2 });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(mentorOf(id)).toBe(2);
    expect((await call(`role/${id}`, 'PUT', base)).status).toBe(200);
    expect(mentorOf(id)).toBe(2);
    expect((await call(`role/${id}`, 'PUT', { ...base, mentor_id: null })).status).toBe(200);
    expect(mentorOf(id)).toBeNull();
  });

  it('cannot be the person themselves', async () => {
    expect((await call('role', 'POST', { ...base, mentor_id: 1 })).status).toBe(400);
  });

  it('moves with a merge and never ends up as the leader themselves', async () => {
    db.raw.exec(`
      INSERT INTO role (id, person_id, activity_id, event_id, leadership_type, mentor_id) VALUES (10, 1, 1, 1, 'assisting', 2);
      INSERT INTO event (id, name, event_type, year) VALUES (2, 'Camp 2026', 'weekend', 2026);
      INSERT INTO role (id, person_id, activity_id, event_id, leadership_type, mentor_id) VALUES (11, 1, 1, 2, 'assisting', 3);
      INSERT INTO role (id, person_id, activity_id, event_id, leadership_type, mentor_id) VALUES (12, 2, 1, 2, 'solo', 3);
    `);
    expect((await call('merge/3/2', 'POST', { confirm: 3 })).status).toBe(200);
    expect(mentorOf(11)).toBe(2); // Other Hand became Old Hand
    expect(mentorOf(12)).toBeNull(); // Old Hand cannot now mentor their own role
    expect(mentorOf(10)).toBe(2);
  });

  it('is cleared on other roles when the mentor is erased', async () => {
    db.raw.exec(
      `INSERT INTO role (id, person_id, activity_id, event_id, leadership_type, mentor_id) VALUES (10, 1, 1, 1, 'assisting', 2)`
    );
    expect((await call('erase/2', 'POST', { confirm: 2 })).status).toBe(200);
    expect(mentorOf(10)).toBeNull();
  });
});

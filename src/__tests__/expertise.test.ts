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

beforeEach(() => {
  db = sqliteD1();
  db.raw.exec(`
    INSERT INTO app_user (email_lower, level, is_admin) VALUES ('admin@example.org', 'standard', 1);
    INSERT INTO person (id, name) VALUES (1, 'Person A');
  `);
});

describe('marking someone an expert', () => {
  it('records it with who set it, shows it in the tool, and can be taken back', async () => {
    const res = await call('expertise', 'POST', { person_id: 1, type: 'Theory', note: ' Led it for years ' });
    expect(res.status).toBe(201);
    const { id } = JSON.parse(await res.text());
    expect(db.raw.prepare('SELECT type, note, created_by FROM expertise').get()).toEqual({
      type: 'Theory',
      note: 'Led it for years',
      created_by: 'admin@example.org',
    });
    expect(JSON.parse(await (await call('bootstrap')).text()).expertise).toHaveLength(1);
    expect((await call(`expertise/${id}`, 'DELETE')).status).toBe(200);
    expect(JSON.parse(await (await call('bootstrap')).text()).expertise).toHaveLength(0);
    expect((await call('expertise', 'POST', { person_id: 1, type: 'Theory' })).status).toBe(201); // again, after removal
  });

  it('allows one live mark per person and type, and needs a type', async () => {
    expect((await call('expertise', 'POST', { person_id: 1, type: 'Theory' })).status).toBe(201);
    expect((await call('expertise', 'POST', { person_id: 1, type: 'Theory' })).status).toBe(409);
    expect((await call('expertise', 'POST', { person_id: 1, type: 'Games' })).status).toBe(201);
    expect((await call('expertise', 'POST', { person_id: 1 })).status).toBe(400);
  });
});

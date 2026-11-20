// Asking someone to staff a slot at a venue: one live ask per person, venue, date, and slot.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteD1 } from './d1-sqlite';

vi.mock('../../functions/_lib/access.js', async (orig) => {
  const real = await orig<typeof import('../../functions/_lib/access.js')>();
  return { ...real, authenticate: async () => ({ email: 'admin@example.org' }) };
});
import { onRequest } from '../../functions/api/internal/leadership/[[path]].js';

let db: ReturnType<typeof sqliteD1>;
const call = (path: string, method: string, body?: unknown) =>
  onRequest({
    request: new Request(`https://ecrs.org/api/internal/leadership/${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { origin: 'https://ecrs.org' },
    }),
    env: { DB: db.d1 },
    params: { path: path.split('/') },
  } as never);
const ask = { person_id: 1, goal: 'staff_slot', status: 'suggested', venue_id: 'camp-onas', slot: 'Games class' };

beforeEach(() => {
  db = sqliteD1();
  db.raw.exec(`
    INSERT INTO app_user (email_lower, level, is_admin) VALUES ('admin@example.org', 'standard', 1);
    INSERT INTO person (id, name) VALUES (1, 'Person A'), (2, 'Person B');
    INSERT INTO event (id, name, event_type, year) VALUES (1, 'Camp 2026', 'weekend', 2026), (2, 'Winter 2026', 'extended', 2026);
  `);
});

describe('staffing asks', () => {
  it('records an ask with its venue and slot, and moves it along', async () => {
    const res = await call('outreach', 'POST', ask);
    expect(res.status).toBe(201);
    const { id } = JSON.parse(await res.text());
    expect(
      (await call(`outreach/${id}`, 'PUT', { ...ask, status: 'contacted', contacted_on: '2026-11-20' })).status
    ).toBe(200);
    expect(db.raw.prepare('SELECT status, venue_id, slot, contacted_on FROM outreach').get()).toEqual({
      status: 'contacted',
      venue_id: 'camp-onas',
      slot: 'Games class',
      contacted_on: '2026-11-20',
    });
  });

  it('refuses a second live ask for the same person, venue, date, and slot, but not another slot, venue, or date', async () => {
    expect((await call('outreach', 'POST', ask)).status).toBe(201);
    expect((await call('outreach', 'POST', ask)).status).toBe(409);
    expect((await call('outreach', 'POST', { ...ask, slot: 'Dance class' })).status).toBe(201);
    expect((await call('outreach', 'POST', { ...ask, venue_id: 'watson' })).status).toBe(201);
    expect((await call('outreach', 'POST', { ...ask, plan_date: '2027-06-18' })).status).toBe(201);
    expect((await call('outreach', 'POST', { ...ask, plan_date: '2027-06-18' })).status).toBe(409);
    expect((await call('outreach', 'POST', { ...ask, plan_date: '2028-06-18' })).status).toBe(201);
    expect((await call('outreach', 'POST', { ...ask, person_id: 2 })).status).toBe(201);
  });

  it('allows asking again once the earlier ask is removed', async () => {
    const { id } = JSON.parse(await (await call('outreach', 'POST', ask)).text());
    expect((await call(`outreach/${id}`, 'DELETE')).status).toBe(200);
    expect((await call('outreach', 'POST', ask)).status).toBe(201);
  });

  it('needs a venue and a slot, and leaves other outreach alone', async () => {
    expect((await call('outreach', 'POST', { ...ask, slot: undefined })).status).toBe(400);
    expect((await call('outreach', 'POST', { ...ask, venue_id: undefined })).status).toBe(400);
    const plain = { person_id: 1, goal: 'invite_back', status: 'contacted' };
    expect((await call('outreach', 'POST', plain)).status).toBe(201);
    expect((await call('outreach', 'POST', plain)).status).toBe(201); // many invitations are fine
    expect(db.raw.prepare('SELECT COUNT(*) n FROM outreach WHERE venue_id IS NULL').get()).toEqual({ n: 2 });
  });
});

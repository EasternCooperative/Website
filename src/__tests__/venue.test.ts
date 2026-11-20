import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteD1 } from './d1-sqlite';
import { lookupPostalCode } from '../../functions/_lib/venues.js';

vi.mock('../../functions/_lib/access.js', async (orig) => {
  const real = await orig<typeof import('../../functions/_lib/access.js')>();
  return { ...real, authenticate: async () => ({ email: 'admin@example.org' }) };
});
import { onRequest } from '../../functions/api/internal/leadership/[[path]].js';

let db: ReturnType<typeof sqliteD1>;
const place = {
  places: [{ 'place name': 'Ottsville', 'state abbreviation': 'PA', latitude: '40.3124', longitude: '-75.1046' }],
};
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
  db.raw.exec("INSERT INTO app_user (email_lower, level, is_admin) VALUES ('admin@example.org', 'standard', 1);");
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(place)))
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('adding a venue', () => {
  it('looks up the postal code, makes an id from the name, and shows up in the tool', async () => {
    const res = await call('venue', 'POST', { name: 'Camp Ottsville', postal_code: '18942-1234' });
    expect(res.status).toBe(201);
    expect(JSON.parse(await res.text()).id).toBe('camp-ottsville');
    expect(db.raw.prepare('SELECT name, city, state, postal_code, lat, created_by FROM venue').get()).toEqual({
      name: 'Camp Ottsville',
      city: 'Ottsville',
      state: 'PA',
      postal_code: '18942',
      lat: 40.3124,
      created_by: 'admin@example.org',
    });
    const boot = JSON.parse(await (await call('bootstrap')).text());
    expect(boot.venues).toEqual([
      { id: 'camp-ottsville', name: 'Camp Ottsville', city: 'Ottsville', state: 'PA', lat: 40.3124, lng: -75.1046 },
    ]);
    expect(JSON.stringify(boot.venues)).not.toContain('18942');
  });

  it('gives a second venue with the same name its own id', async () => {
    await call('venue', 'POST', { name: 'Camp', postal_code: '18942' });
    expect(JSON.parse(await (await call('venue', 'POST', { name: 'Camp', postal_code: '18942' })).text()).id).toBe(
      'camp-2'
    );
    expect(JSON.parse(await (await call('venue', 'POST', { name: '!!!', postal_code: '18942' })).text()).id).toBe(
      'venue'
    );
  });

  it('refuses a missing name, a bad postal code, and one that cannot be found', async () => {
    expect((await call('venue', 'POST', { postal_code: '18942' })).status).toBe(400);
    expect((await call('venue', 'POST', { name: 'x'.repeat(121), postal_code: '18942' })).status).toBe(400);
    expect((await call('venue', 'POST', { name: 'Camp', postal_code: 'K1A' })).status).toBe(400);
    expect((await call('venue', 'POST', { name: 'Camp' })).status).toBe(400);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 }))
    );
    expect((await call('venue', 'POST', { name: 'Camp', postal_code: '00000' })).status).toBe(400);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM venue').get()).toEqual({ n: 0 });
  });
});

describe('lookupPostalCode', () => {
  it('returns null on a network failure or an odd answer', async () => {
    expect(
      await lookupPostalCode('18942', (async () => {
        throw new Error('down');
      }) as never)
    ).toBeNull();
    expect(
      await lookupPostalCode(
        '18942',
        (async () => new Response(JSON.stringify({ places: [{ latitude: 'x' }] }))) as never
      )
    ).toBeNull();
    expect(
      await lookupPostalCode(
        '18942',
        (async () => new Response(JSON.stringify({ places: [{ latitude: '1', longitude: '2' }] }))) as never
      )
    ).toEqual({ city: null, state: null, lat: 1, lng: 2 });
  });
});

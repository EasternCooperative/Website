import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteD1 } from './d1-sqlite';
import { lookupAddress, lookupPostalCode } from '../../functions/_lib/venues.js';

vi.mock('../../functions/_lib/access.js', async (orig) => {
  const real = await orig<typeof import('../../functions/_lib/access.js')>();
  return { ...real, authenticate: async () => ({ email: 'admin@example.org' }) };
});
import { onRequest } from '../../functions/api/internal/leadership/[[path]].js';

let db: ReturnType<typeof sqliteD1>;
const zip = {
  places: [{ 'place name': 'Ottsville', 'state abbreviation': 'PA', latitude: '40.3124', longitude: '-75.1046' }],
};
const census = {
  result: {
    addressMatches: [
      {
        matchedAddress: '609 GEIGEL HILL RD, OTTSVILLE, PA, 18942',
        coordinates: { x: -75.1046, y: 40.3124 },
        addressComponents: { city: 'OTTSVILLE', state: 'PA', zip: '18942' },
      },
    ],
  },
};
let censusAnswer: Response | 'down';
let zipAnswer: Response;
const stub = async (url: string) => {
  if (String(url).includes('census.gov')) {
    if (censusAnswer === 'down') throw new Error('down');
    return censusAnswer.clone();
  }
  return zipAnswer.clone();
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
  censusAnswer = new Response(JSON.stringify(census));
  zipAnswer = new Response(JSON.stringify(zip));
  vi.stubGlobal('fetch', vi.fn(stub));
});
afterEach(() => vi.unstubAllGlobals());

describe('adding a venue', () => {
  it('finds the address, makes an id from the name, and shows up in the tool', async () => {
    const res = await call('venue', 'POST', { name: 'Camp Ottsville', address: '609 Geigel Hill Rd, Ottsville PA' });
    expect(res.status).toBe(201);
    expect(JSON.parse(await res.text()).id).toBe('camp-ottsville');
    expect(db.raw.prepare('SELECT name, city, state, postal_code, address, lat, created_by FROM venue').get()).toEqual({
      name: 'Camp Ottsville',
      city: 'OTTSVILLE',
      state: 'PA',
      postal_code: '18942',
      address: '609 GEIGEL HILL RD, OTTSVILLE, PA, 18942',
      lat: 40.3124,
      created_by: 'admin@example.org',
    });
    const boot = JSON.parse(await (await call('bootstrap')).text());
    expect(boot.venues[0]).toMatchObject({ id: 'camp-ottsville', name: 'Camp Ottsville', lat: 40.3124, lng: -75.1046 });
  });

  it('falls back to a postal code when the street is not found', async () => {
    censusAnswer = new Response(JSON.stringify({ result: { addressMatches: [] } }));
    const res = await call('venue', 'POST', { name: 'Hidden Camp', address: 'Somewhere Rd, Ottsville PA 18942' });
    expect(res.status).toBe(201);
    expect(db.raw.prepare('SELECT city, postal_code, address FROM venue').get()).toEqual({
      city: 'Ottsville',
      postal_code: '18942',
      address: null,
    });
    const only = await call('venue', 'POST', { name: 'Zip Only', postal_code: '18942-1234' });
    expect(only.status).toBe(201);
  });

  it('gives a second venue with the same name its own id', async () => {
    await call('venue', 'POST', { name: 'Camp', address: '1 Main St, Ottsville PA' });
    expect(
      JSON.parse(await (await call('venue', 'POST', { name: 'Camp', address: '1 Main St, Ottsville PA' })).text()).id
    ).toBe('camp-2');
    expect(
      JSON.parse(await (await call('venue', 'POST', { name: '!!!', address: '1 Main St, Ottsville PA' })).text()).id
    ).toBe('venue');
  });

  it('refuses a missing name or address, and an address that cannot be found', async () => {
    expect((await call('venue', 'POST', { address: '1 Main St' })).status).toBe(400);
    expect((await call('venue', 'POST', { name: 'x'.repeat(121), address: '1 Main St' })).status).toBe(400);
    expect((await call('venue', 'POST', { name: 'Camp' })).status).toBe(400);
    expect((await call('venue', 'POST', { name: 'Camp', address: 'x'.repeat(201) })).status).toBe(400);
    censusAnswer = new Response('{}', { status: 500 });
    zipAnswer = new Response('{}', { status: 404 });
    expect((await call('venue', 'POST', { name: 'Camp', address: 'Nowhere Lane' })).status).toBe(400);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM venue').get()).toEqual({ n: 0 });
  });
});

describe('the lookups', () => {
  const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as never;
  it('return null on a network failure, an unusable answer, or an error status', async () => {
    const down = (async () => {
      throw new Error('down');
    }) as never;
    expect(await lookupPostalCode('18942', down)).toBeNull();
    expect(await lookupAddress('1 Main St', down)).toBeNull();
    expect(await lookupPostalCode('18942', answer({ places: [{ latitude: 'x' }] }))).toBeNull();
    expect(
      await lookupAddress('1 Main St', answer({ result: { addressMatches: [{ coordinates: { x: 'a', y: 'b' } }] } }))
    ).toBeNull();
    expect(await lookupAddress('1 Main St', answer({}, 500))).toBeNull();
    expect(await lookupAddress('1 Main St', answer({}))).toBeNull();
  });
  it('fill in what is missing', async () => {
    expect(await lookupPostalCode('18942', answer({ places: [{ latitude: '1', longitude: '2' }] }))).toEqual({
      city: null,
      state: null,
      zip: '18942',
      lat: 1,
      lng: 2,
      address: null,
    });
    expect(
      await lookupAddress('1 Main St', answer({ result: { addressMatches: [{ coordinates: { x: 2, y: 1 } }] } }))
    ).toEqual({
      city: null,
      state: null,
      zip: '',
      lat: 1,
      lng: 2,
      address: null,
    });
  });
});

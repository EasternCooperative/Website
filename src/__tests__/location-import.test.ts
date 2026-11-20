import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteD1 } from './d1-sqlite';
import {
  cognitoLocationRows,
  locationStatements,
  placeOf,
  zeffyLocationRows,
} from '../../scripts/lib/location-import.mjs';

vi.mock('../../functions/_lib/access.js', async (orig) => {
  const real = await orig<typeof import('../../functions/_lib/access.js')>();
  return { ...real, authenticate: async () => ({ email: 'admin@example.org' }) };
});
import { onRequest } from '../../functions/api/internal/leadership/[[path]].js';

// Synthetic data only. Postal codes are real places, with made-up people.
const entry = (over: Record<string, unknown> = {}) => ({
  Id: 'e1',
  Entry: { Status: 'Submitted', DateSubmitted: '2024-05-01T10:00:00Z' },
  Address: { PostalCode: '19103-1234', City: 'Somewhere', State: 'XX', StreetAddress: '1 Private Lane' },
  AttendeeInformation: [
    { Id: 'a', Name: { First: 'Pat', Last: 'Lee', FirstAndLast: 'Pat Lee' }, Email: 'Pat@Example.org', Adult: true },
  ],
  ...over,
});

describe('placeOf', () => {
  it('gives the city, state, and center of a US postal code, and nothing for anything else', () => {
    expect(placeOf('19103-1234')).toMatchObject({ postal_code: '19103', city: 'Philadelphia', state: 'PA' });
    expect(placeOf(' 19103 ')?.lat).toBeCloseTo(39.95, 1);
    expect(placeOf('00000')).toBeNull();
    expect(placeOf('K1A 0B1')).toBeNull();
    expect(placeOf(undefined)).toBeNull();
  });
});

describe('cognitoLocationRows', () => {
  it('attaches the address to the registrant, and never keeps the street or the typed city', () => {
    const [row] = cognitoLocationRows([entry()], '131');
    expect(row).toMatchObject({
      first: 'Pat',
      last: 'Lee',
      email: 'pat@example.org',
      postal_code: '19103',
      city: 'Philadelphia',
      asOf: '2024-05-01',
    });
    expect(JSON.stringify(row)).not.toMatch(/Private Lane|Somewhere/);
  });
  it('knows who the membership and donation forms mean', () => {
    const member = {
      ...entry(),
      PrimaryMemberFirstName: ' Sam ',
      PrimaryMemberLastName: 'Rivera',
      Email: 'S@x.org',
      AttendeeInformation: undefined,
    };
    expect(cognitoLocationRows([member], '16')[0]).toMatchObject({ first: 'Sam', last: 'Rivera', email: 's@x.org' });
    const donor = {
      ...entry(),
      DonorName: { First: 'Kit', Last: 'Fox' },
      DonorEmail: null,
      AttendeeInformation: undefined,
    };
    expect(cognitoLocationRows([donor], '24')[0]).toMatchObject({ first: 'Kit', last: 'Fox', email: null });
    const donor2 = { ...donor, DonorName: { FirstAndLast: 'Kit Fox' } };
    expect(cognitoLocationRows([donor2], '24')[0].first).toBe('Kit Fox');
  });
  it('skips incomplete entries, foreign or missing postal codes, and entries with no one to attach to', () => {
    expect(
      cognitoLocationRows(
        [
          entry({ Entry: { Status: 'Incomplete' } }),
          entry({ Address: { PostalCode: 'K1A 0B1' } }),
          entry({ Address: undefined }),
          entry({ AttendeeInformation: [] }),
          entry({ Entry: { Status: 'Submitted' } }), // undated still counts, as the oldest
        ],
        '131'
      ).map((r: { asOf: string }) => r.asOf)
    ).toEqual(['0000-00-00']);
  });
});

describe('zeffyLocationRows', () => {
  const header = [
    'Payment Status',
    'First Name',
    'Last Name',
    'Email',
    'Postal Code',
    'Country',
    'Payment Date (America/Los_Angeles)',
  ];
  it('reads US payments with a postal code, in date order terms', () => {
    const rows = zeffyLocationRows(header, [
      ['Succeeded', 'Pat', 'Lee', 'Pat@Example.org', '19103', 'United States', '5/3/2025'],
      ['Refunded', 'Ann', 'Ng', null, '19103', 'United States', '5/3/2025'],
      ['Succeeded', 'Bo', 'Ng', null, '19103', 'Canada', '5/3/2025'],
      ['Succeeded', '', '', null, '19103', 'US', '5/3/2025'],
      ['Succeeded', 'Cy', 'Ng', null, 'nope', 'US', '5/3/2025'],
      ['Succeeded', 'Di', 'Ng', null, '19103', null, 'unclear'],
    ]);
    expect(rows.map((r: { first: string; asOf: string }) => [r.first, r.asOf])).toEqual([
      ['Pat', '2025-05-03'],
      ['Di', '0000-00-00'],
    ]);
    expect(rows[0].email).toBe('pat@example.org');
  });
  it('copes with an export that has no status or country columns', () => {
    expect(zeffyLocationRows(['First Name', 'Last Name', 'Postal Code'], [['Pat', 'Lee', '19103']])).toHaveLength(1);
  });
});

describe('locationStatements and the database', () => {
  let db: ReturnType<typeof sqliteD1>;
  const people = [
    { id: 1, name: 'Pat Lee', emails: ['pat@example.org'] },
    { id: 2, name: 'Sam Rivera', emails: [] },
  ];
  const run = (rows: unknown[]) => {
    const { statements, counts } = locationStatements({ rows, people });
    statements.forEach((s: string) => db.raw.exec(s));
    return counts;
  };
  const row = (first: string, last: string, zip: string, asOf: string, email: string | null = null) => ({
    first,
    last,
    email,
    ...placeOf(zip)!,
    source: 'cognito',
    asOf,
  });
  const one = (sql: string) => db.raw.prepare(sql).get();

  beforeEach(() => {
    db = sqliteD1();
    db.raw.exec("INSERT INTO person (id, name) VALUES (1, 'Pat Lee'), (2, 'Sam Rivera');");
  });

  it('records the newest location per person, once, and ignores people who are not in the database', () => {
    const rows = [
      row('Pat', 'Lee', '19103', '2023-01-01'),
      row('Pat', 'Lee', '10001', '2025-01-01'),
      row('Nobody', 'Known', '19103', '2025-01-01'),
    ];
    const counts = run(rows);
    run(rows);
    expect(one('SELECT COUNT(*) n FROM person_location')).toEqual({ n: 1 });
    expect(one('SELECT postal_code, city, state FROM person_location WHERE person_id = 1')).toEqual({
      postal_code: '10001',
      city: 'New York',
      state: 'NY',
    });
    expect(counts).toMatchObject({ rows: 3, located: 1, notInDatabase: 1 });
  });

  it('keeps a newer location it already has, and replaces an older one', () => {
    run([row('Pat', 'Lee', '10001', '2025-01-01')]);
    run([row('Pat', 'Lee', '19103', '2022-01-01')]);
    expect(one('SELECT postal_code FROM person_location')).toEqual({ postal_code: '10001' });
    run([row('Pat', 'Lee', '19103', '2026-01-01')]);
    expect(one('SELECT postal_code FROM person_location')).toEqual({ postal_code: '19103' });
  });

  it('leaves out anyone it cannot place with confidence', () => {
    const counts = run([row('Pat', 'Leigh', '19103', '2025-01-01')]);
    expect(counts.needDecision + counts.notInDatabase).toBeGreaterThan(0);
    expect(one('SELECT COUNT(*) n FROM person_location')).toEqual({ n: 0 });
  });

  describe('through the tool', () => {
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
      db.raw.exec("INSERT INTO app_user (email_lower, level, is_admin) VALUES ('admin@example.org', 'standard', 1);");
      run([row('Pat', 'Lee', '19103', '2025-01-01'), row('Sam', 'Rivera', '10001', '2025-01-01')]);
    });

    it('sends city, state, and a rounded point, and never the postal code or a street', async () => {
      const text = await (await call('bootstrap')).text();
      const { locations } = JSON.parse(text);
      expect(locations).toHaveLength(2);
      expect(locations[0]).toEqual({ person_id: 1, city: 'Philadelphia', state: 'PA', lat: 39.95, lng: -75.17 });
      expect(text).not.toContain('19103');
    });

    it('is cleared when a person is erased', async () => {
      expect((await call('erase/1', 'POST', { confirm: 1 })).status).toBe(200);
      expect(one('SELECT COUNT(*) n FROM person_location WHERE person_id = 1')).toEqual({ n: 0 });
    });

    it('moves to the person kept in a merge, or yields to the one they already have', async () => {
      db.raw.exec("INSERT INTO person (id, name) VALUES (3, 'Kit Fox');");
      expect((await call('merge/3/1', 'POST', { confirm: 3 })).status).toBe(200); // Kit has none: Pat keeps hers
      expect(one('SELECT postal_code FROM person_location WHERE person_id = 1')).toEqual({ postal_code: '19103' });
      expect((await call('merge/2/1', 'POST', { confirm: 2 })).status).toBe(200); // both have one: the survivor's stays
      expect(one('SELECT COUNT(*) n FROM person_location')).toEqual({ n: 1 });
      expect(one('SELECT postal_code FROM person_location')).toEqual({ postal_code: '19103' });
      db.raw.exec("INSERT INTO person (id, name) VALUES (4, 'Di Gray');");
      db.raw.exec(
        "INSERT INTO person_location (person_id, city, state, postal_code, lat, lng) VALUES (4, 'X', 'PA', '19103', 1, 1);"
      );
      db.raw.exec("INSERT INTO person (id, name) VALUES (5, 'No Place');");
      expect((await call('merge/4/5', 'POST', { confirm: 4 })).status).toBe(200); // the survivor had none: takes it
      expect(one('SELECT COUNT(*) n FROM person_location WHERE person_id = 5')).toEqual({ n: 1 });
    });
  });
});

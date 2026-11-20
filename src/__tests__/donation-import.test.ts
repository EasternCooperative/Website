import { beforeEach, describe, expect, it } from 'vitest';
import { sqliteD1 } from './d1-sqlite';
import { identitiesFrom, resolveIdentities } from '../../scripts/lib/cognito-import.mjs';
import {
  cognitoGiftRows,
  donationStatements,
  paymentRef,
  zeffyDonationRows,
} from '../../scripts/lib/donation-import.mjs';
import { isoDate, zeffyGiftRows } from '../../scripts/lib/giving-bands.mjs';
import { makeGet } from '../../scripts/lib/cognito-api.mjs';

// Synthetic data only.
const header = [
  'Payment Date (America/Los_Angeles)',
  'Payment Time (America/Los_Angeles)',
  'Total Amount',
  'Payment Status',
  'Recurring Status',
  'First Name',
  'Last Name',
  'Email',
  'Campaign Title',
  'Rate Title',
  'Item Amount',
  'Refund Amount',
];
const zrow = (o: Record<string, unknown>) => header.map((h) => o[h] ?? null);
const D = '5/23/2026';

describe('Zeffy gift rows', () => {
  const rows = [
    zrow({
      [header[0]]: D,
      [header[1]]: '1:00 PM',
      'Total Amount': 50,
      'Payment Status': 'Succeeded',
      'First Name': 'Pat',
      'Last Name': 'Lee',
      Email: 'pat@example.org',
      'Campaign Title': 'One Time Supporting Donation',
    }),
    zrow({
      [header[0]]: D,
      [header[1]]: '2:00 PM',
      'Total Amount': 10,
      'Payment Status': 'Succeeded',
      'Recurring Status': 'Monthly',
      'First Name': 'Sam',
      'Last Name': 'Rivera',
      Email: 's@example.org',
      'Campaign Title': 'Monthly Sustaining Donation',
    }),
    zrow({
      [header[0]]: D,
      [header[1]]: '3:00 PM',
      'Payment Status': 'Succeeded',
      'First Name': 'Pat',
      'Last Name': 'Lee',
      Email: 'pat@example.org',
      'Campaign Title': 'Fun Day',
      'Rate Title': 'Additional donation',
      'Item Amount': 20,
    }),
    zrow({
      [header[0]]: D,
      [header[1]]: '3:00 PM',
      'Payment Status': 'Succeeded',
      'First Name': 'Pat',
      'Last Name': 'Lee',
      Email: 'pat@example.org',
      'Campaign Title': 'Fun Day',
      'Rate Title': 'Additional donation',
      'Item Amount': 5,
    }),
    zrow({
      [header[0]]: D,
      [header[1]]: '3:00 PM',
      'Payment Status': 'Succeeded',
      'First Name': 'Pat',
      'Last Name': 'Lee',
      Email: 'pat@example.org',
      'Campaign Title': 'Fun Day',
      'Rate Title': 'General admission',
      'Item Amount': 15,
    }),
  ];

  it('keeps the detail a load needs, and gives repeated lines in one payment their own reference', () => {
    const { rows: g } = zeffyGiftRows(header, rows);
    expect(
      g.map((x: { cents: number; date: string | null; recurring: number; lineRef: string }) => [
        x.cents,
        x.date,
        x.recurring,
        x.lineRef,
      ])
    ).toEqual([
      [5000, '2026-05-23', 0, ''],
      [1000, '2026-05-23', 1, ''],
      [2000, '2026-05-23', 0, 'Additional donation#1'],
      [500, '2026-05-23', 0, 'Additional donation#2'],
    ]);
    expect(g[2].payment).toBe(g[3].payment); // one payment, two lines
    expect(g[0].email).toBe('pat@example.org');
  });

  it('turns them into donation rows whose reference holds no name', () => {
    const out = zeffyDonationRows(zeffyGiftRows(header, rows).rows);
    expect(out[0]).toMatchObject({ source: 'zeffy', cents: 5000, campaign: 'One Time Supporting Donation' });
    expect(out[0].sourceRef).toMatch(/^[0-9a-f]{20}$/);
    expect(out[0].sourceRef).toBe(paymentRef(zeffyGiftRows(header, rows).rows[0].payment));
    expect(JSON.stringify(out.map((o: { sourceRef: string }) => o.sourceRef))).not.toMatch(/Pat|Lee/);
    expect(zeffyDonationRows([{ date: null }] as never)).toEqual([]);
  });

  it('reads Zeffy dates, and ignores anything else', () => {
    expect([isoDate('5/3/2026'), isoDate('12/31/2025'), isoDate('soon'), isoDate(null)]).toEqual([
      '2026-05-03',
      '2025-12-31',
      null,
      null,
    ]);
  });
});

describe('Cognito gift rows', () => {
  const entry = (over: object = {}) => ({
    Id: '24-5',
    Entry: { Status: 'Submitted', DateSubmitted: '2025-03-01T10:00:00Z' },
    Order: { PaymentStatus: 'Paid', AmountPaid: 25, PaymentDate: '2025-03-02T10:00:00Z' },
    DonorName: { First: 'Ann', Last: 'Wu', FirstAndLast: 'Ann Wu' },
    DonorEmail: ' Ann@Example.org ',
    ...over,
  });

  it('keeps paid, complete gifts net of refunds, dated by payment', () => {
    const out = cognitoGiftRows([
      entry(),
      entry({
        Id: '24-6',
        Order: { PaymentStatus: 'Paid', OrderAmount: 100, RefundAmount: 40, Date: '2025-04-01T00:00:00Z' },
      }),
      entry({ Id: '24-7', Order: { PaymentStatus: 'Unpaid', AmountPaid: 5 } }),
      entry({ Id: '24-8', Entry: { Status: 'Incomplete' } }),
      entry({ Id: '24-9', Order: { PaymentStatus: 'Paid', AmountPaid: 'x' } }),
      entry({ Id: '24-10', Order: { PaymentStatus: 'Paid', AmountPaid: 10, RefundAmount: 10 } }),
      entry({ Id: '24-11', DonorName: {}, DonorEmail: '' }),
      entry({ Id: '24-12', Order: { PaymentStatus: 'Paid', AmountPaid: 5 }, Entry: {} }),
      { Id: 'x' },
    ]);
    expect(
      out.map((g: { sourceRef: string; cents: number; date: string; email: string }) => [
        g.sourceRef,
        g.cents,
        g.date,
        g.email,
      ])
    ).toEqual([
      ['24-5', 2500, '2025-03-02', 'ann@example.org'],
      ['24-6', 6000, '2025-04-01', 'ann@example.org'],
    ]);
    expect(cognitoGiftRows([entry({ DonorName: { FirstAndLast: 'Solo Name' } })])[0]).toMatchObject({
      first: 'Solo Name',
      last: '',
    });
  });
});

describe('loading gifts', () => {
  let db: ReturnType<typeof sqliteD1>;
  const people = [{ id: 1, name: 'Pat Lee', emails: ['pat@example.org'] }];
  const gift = (first: string, last: string, cents: number, email: string | null = null, over = {}) => ({
    first,
    last,
    email,
    cents,
    date: '2026-05-23',
    source: 'zeffy',
    sourceRef: `ref-${first}-${cents}`,
    lineRef: '',
    campaign: 'Fun Day',
    recurring: 0,
    ...over,
  });
  const build = (rows: ReturnType<typeof gift>[]) => {
    const { identities, sharedEmails } = identitiesFrom(rows);
    const r = resolveIdentities(identities, people);
    return donationStatements({ rows, resolved: r.resolved, alias: r.alias, sharedEmails, newStatus: 'inactive' });
  };
  const run = (sqls: string[]) => sqls.forEach((s) => db.raw.exec(s));
  const count = (t: string) => (db.raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;

  beforeEach(() => {
    db = sqliteD1();
    db.raw.exec("INSERT INTO person (id, name) VALUES (1, 'Pat Lee');");
  });

  it('loads a gift for a known person and a new one, once, and feeds the giving tier', () => {
    const sqls = build([
      gift('Pat', 'Lee', 6000, 'pat@example.org'),
      gift('New', 'Donor', 30000, 'n@example.org', { recurring: 1 }),
    ]);
    run(sqls);
    run(sqls);
    expect(
      db.raw
        .prepare('SELECT person_id, amount_cents, donated_at, recurring, created_by FROM donation ORDER BY id')
        .all()
    ).toEqual([
      { person_id: 1, amount_cents: 6000, donated_at: '2026-05-23', recurring: 0, created_by: 'script:cognito-import' },
      {
        person_id: 2,
        amount_cents: 30000,
        donated_at: '2026-05-23',
        recurring: 1,
        created_by: 'script:cognito-import',
      },
    ]);
    expect(db.raw.prepare('SELECT name, status FROM person WHERE id = 2').get()).toEqual({
      name: 'New Donor',
      status: 'inactive',
    });
    expect(
      db.raw.prepare('SELECT person_id, giving_tier_rank FROM person_engagement ORDER BY person_id').all()
    ).toEqual([
      { person_id: 1, giving_tier_rank: 1 }, // $60 and $300 against the starting tiers ($100 and $500); the live ones are set
      { person_id: 2, giving_tier_rank: 2 },
    ]);
  });

  it('keeps separate lines of one payment, and does not load a gift for someone skipped', () => {
    const rows = [
      gift('Pat', 'Lee', 2000, 'pat@example.org', { sourceRef: 'p1', lineRef: 'Additional donation#1' }),
      gift('Pat', 'Lee', 500, 'pat@example.org', { sourceRef: 'p1', lineRef: 'Additional donation#2' }),
      gift('Skip', 'Me', 9900),
    ];
    const { identities, sharedEmails } = identitiesFrom(rows);
    const r = resolveIdentities(identities, people, { decisions: new Map([['skip me', 'skip']]) });
    run(donationStatements({ rows, resolved: r.resolved, alias: r.alias, sharedEmails, newStatus: 'inactive' }));
    expect(count('donation')).toBe(2);
    expect(db.raw.prepare("SELECT COUNT(*) n FROM person WHERE name = 'Skip Me'").get()).toEqual({ n: 0 });
  });

  it('puts a gift under a folded spelling on the one person', () => {
    const rows = [gift('Alex', 'Park', 5000, 'a@x.org'), gift('Alexa', 'Park', 1000, 'b@x.org')];
    const { identities, sharedEmails } = identitiesFrom(rows);
    const r = resolveIdentities(identities, people, { decisions: new Map([['alexa park', 'as:Alex Park']]) });
    run(donationStatements({ rows, resolved: r.resolved, alias: r.alias, sharedEmails, newStatus: 'inactive' }));
    expect(db.raw.prepare('SELECT COUNT(DISTINCT person_id) n, COUNT(*) c FROM donation').get()).toEqual({
      n: 1,
      c: 2,
    });
  });
});

describe('the Cognito request helper', () => {
  const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });

  it('returns the body, null for a 404, and retries a rate limit with the wait the server asks for', async () => {
    const waits: number[] = [];
    const answers = [res(429, {}, { 'Retry-After': '3' }), res(200, { ok: 1 })];
    const get = makeGet('k', {
      budget: { spend() {} },
      fetchImpl: (async () => answers.shift()!) as never,
      wait: async (ms: number) => void waits.push(ms),
    });
    expect(await get('/forms/1')).toEqual({ ok: 1 });
    expect(waits).toEqual([3000]);
    expect(await makeGet('k', { budget: { spend() {} }, fetchImpl: (async () => res(404)) as never })('/x')).toBeNull();
  });

  it('retries a failed or hung request, gives up after a while, and refuses an unexpected error', async () => {
    let calls = 0;
    const flaky = makeGet('k', {
      budget: { spend() {} },
      fetchImpl: (async () => (++calls < 3 ? Promise.reject(new Error('hung')) : res(200, { ok: 2 }))) as never,
      wait: async () => {},
    });
    expect(await flaky('/x')).toEqual({ ok: 2 });
    await expect(
      makeGet('k', { budget: { spend() {} }, fetchImpl: (async () => res(429)) as never, wait: async () => {} })('/x')
    ).rejects.toThrow('kept failing');
    await expect(
      makeGet('k', { budget: { spend() {} }, fetchImpl: (async () => res(500)) as never })('/x')
    ).rejects.toThrow('Cognito API 500');
  });
});

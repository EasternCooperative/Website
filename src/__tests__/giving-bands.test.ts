import { describe, expect, it } from 'vitest';
import {
  NICE,
  bandCounts,
  bandSql,
  cognitoGifts,
  donorKey,
  giftSizes,
  hideSmall,
  withoutTestGifts,
  proposeBands,
  reach,
  totalsByDonor,
  zeffyGifts,
} from '../../scripts/lib/giving-bands.mjs';

// Synthetic data only.
const header = [
  'Payment Status',
  'Campaign Title',
  'Rate Title',
  'Item Amount',
  'Total Amount',
  'Refund Amount',
  'First Name',
  'Last Name',
  'Email',
  'Email',
];
const row = (o: Partial<Record<string, unknown>>) =>
  header.map((h, i) => (h === 'Email' ? (i === 8 ? (o.email ?? null) : (o.formEmail ?? null)) : (o[h] ?? null)));

describe('who a gift belongs to', () => {
  it('prefers email, falls back to a normalized name, and gives up on neither', () => {
    expect(donorKey(' A@B.org ', 'x')).toBe('e:a@b.org');
    expect(donorKey('', 'Zoë  O’Neil-Smith')).toBe('n:zoe oneil smith');
    expect(donorKey(null, '  ')).toBeNull();
  });
});

describe('Zeffy gifts', () => {
  const rows = [
    row({
      'Payment Status': 'Succeeded',
      'Campaign Title': 'One Time Supporting Donation',
      'Total Amount': 50,
      email: 'a@x.org',
    }),
    row({
      'Payment Status': 'Succeeded',
      'Campaign Title': 'Monthly Sustaining Donation',
      'Total Amount': 10,
      email: 'a@x.org',
    }),
    row({
      'Payment Status': 'Failed',
      'Campaign Title': 'One Time Supporting Donation',
      'Total Amount': 999,
      email: 'a@x.org',
    }),
    row({
      'Payment Status': 'Succeeded',
      'Campaign Title': 'Fun Day',
      'Rate Title': 'Additional donation',
      'Item Amount': 20,
      email: 'b@x.org',
    }),
    row({
      'Payment Status': 'Succeeded',
      'Campaign Title': 'Fun Day',
      'Rate Title': 'General admission',
      'Item Amount': 15,
      email: 'b@x.org',
    }),
    row({
      'Payment Status': 'Succeeded',
      'Campaign Title': 'Fun Day',
      'Rate Title': 'Help Us Help Others',
      'Item Amount': 30,
      email: 'c@x.org',
    }),
    row({
      'Payment Status': 'Succeeded',
      'Campaign Title': 'Fun Day',
      'Rate Title': '(Optional) Donation for Snacks',
      'Item Amount': 5,
      formEmail: 'd@x.org',
    }),
    row({
      'Payment Status': 'Succeeded',
      'Campaign Title': 'One Time Supporting Donation',
      'Total Amount': 40,
      'Refund Amount': 40,
      email: 'e@x.org',
    }),
    row({
      'Payment Status': 'Succeeded',
      'Campaign Title': 'One Time Supporting Donation',
      'Total Amount': 25,
      'First Name': 'No',
      'Last Name': 'Email',
    }),
    row({
      'Payment Status': 'Succeeded',
      'Campaign Title': 'One Time Supporting Donation',
      'Total Amount': 'n/a',
      email: 'f@x.org',
    }),
  ];

  it('counts donation campaigns and gift lines, not tickets, failures, or full refunds', () => {
    const { gifts, counted } = zeffyGifts(header, rows);
    expect(gifts.map((g) => [g.key, g.cents])).toEqual([
      ['e:a@x.org', 5000],
      ['e:a@x.org', 1000],
      ['e:b@x.org', 2000],
      ['e:d@x.org', 500], // the email from the form answers, when the payer column is empty
      ['n:no email', 2500],
    ]);
    expect(counted).toEqual({ donationPayments: 5, giftLines: 2, slidingLines: 0, slidingExcluded: 1 });
  });

  it('counts the sliding-scale tiers only when asked', () => {
    const { gifts, counted } = zeffyGifts(header, rows, { includeSliding: true });
    expect(gifts.find((g) => g.key === 'e:c@x.org')?.cents).toBe(3000);
    expect(counted.slidingLines).toBe(1);
  });
});

describe('Cognito gifts', () => {
  it('counts paid, complete entries, net of refunds', () => {
    const entry = (over: object) => ({
      Entry: { Status: 'Submitted' },
      Order: { PaymentStatus: 'Paid', AmountPaid: 25, RefundAmount: 0 },
      DonorEmail: 'a@x.org',
      DonorName: { FirstAndLast: 'A B' },
      ...over,
    });
    const { gifts, used } = cognitoGifts([
      entry({}),
      entry({ Order: { PaymentStatus: 'Paid', OrderAmount: 100, RefundAmount: 40 } }),
      entry({ Order: { PaymentStatus: 'Unpaid', AmountPaid: 500 } }),
      entry({ Entry: { Status: 'Incomplete' } }),
      entry({ Order: { PaymentStatus: 'Paid', AmountPaid: 'x' } }),
      entry({ DonorEmail: '', DonorName: undefined }),
      entry({ Order: { PaymentStatus: 'Paid', AmountPaid: 10, RefundAmount: 10 } }),
      {},
    ]);
    expect(used).toBe(2);
    expect(gifts).toEqual([
      { key: 'e:a@x.org', cents: 2500 },
      { key: 'e:a@x.org', cents: 6000 },
    ]);
  });
});

describe('test payments', () => {
  it('drops gifts under the minimum and says how many', () => {
    const gifts = [
      { key: 'a', cents: 100 },
      { key: 'a', cents: 199 },
      { key: 'b', cents: 200 },
      { key: 'c', cents: 5000 },
    ];
    expect(withoutTestGifts(gifts)).toEqual({ gifts: gifts.slice(2), dropped: 2 });
    expect(withoutTestGifts(gifts, 1000)).toEqual({ gifts: [gifts[3]], dropped: 3 });
  });
});

describe('small gifts', () => {
  it('counts gifts and donors below each small figure', () => {
    const gifts = [
      { key: 'a', cents: 100 },
      { key: 'a', cents: 500 },
      { key: 'b', cents: 900 },
      { key: 'c', cents: 1000 },
      { key: 'c', cents: 5000 },
    ];
    const sizes = giftSizes(gifts, [5, 10, 100]);
    expect(sizes).toMatchObject({ gifts: 5, donors: 3 });
    expect(sizes.below).toEqual([
      { dollars: 5, gifts: 1, donorsWithOnlySuch: 0 }, // only a's $1 is under $5, and a also gave $5
      { dollars: 10, gifts: 3, donorsWithOnlySuch: 2 }, // a and b never gave $10 or more
      { dollars: 100, gifts: 5, donorsWithOnlySuch: 3 },
    ]);
    expect(giftSizes([])).toMatchObject({ gifts: 0, donors: 0 });
  });
});

describe('the bands', () => {
  const totals = totalsByDonor(
    Array.from({ length: 20 }, (_, i) => ({ key: `e:s${i}`, cents: 2000 })), // 20 small donors, $20
    Array.from({ length: 10 }, (_, i) => ({ key: `e:m${i}`, cents: 7500 })), // 10 medium, $75
    Array.from({ length: 4 }, (_, i) => ({ key: `e:l${i}`, cents: 50000 })), // 4 large, $500
    [{ key: 'e:s0', cents: 500 }] // a second gift from the same donor adds up, to $25
  );

  it('totals per donor across sources and sorts', () => {
    expect(totals).toHaveLength(34);
    expect(totals[0]).toBe(2000);
    expect(totals).toContain(2500);
    expect(totalsByDonor([{ key: 'a', cents: 0 }])).toEqual([]);
  });

  it('proposes round cutoffs that split donors about 50, 35, and 15 percent', () => {
    expect(proposeBands(totals)).toEqual({ medium: 25, large: 100 });
    expect(bandCounts(totals, { medium: 25, large: 100 })).toEqual({ small: 19, medium: 11, large: 4 });
  });

  it('keeps the cutoffs apart when the data is bunched', () => {
    const same = Array.from({ length: 30 }, () => 5000);
    const { medium, large } = proposeBands(same)!;
    expect(large).toBeGreaterThan(medium);
    expect(NICE).toContain(medium);
    expect(proposeBands([1, 2, 3])).toBeNull(); // too few donors to say anything
  });

  it('reports how many donors reach each round figure, and hides small counts', () => {
    const r = reach(totals);
    expect(r.find((x) => x.dollars === 500)?.donors).toBe(4);
    expect(r.every((x) => x.donors > 0)).toBe(true);
    expect([hideSmall(0), hideSmall(2), hideSmall(3), hideSmall(40)]).toEqual(['<3', '<3', '3', '40']);
  });

  it('writes the statements that set the live bands', () => {
    expect(bandSql({ medium: 100, large: 500 })).toBe(
      'UPDATE giving_tier SET min_cents = 10000 WHERE rank = 2;\nUPDATE giving_tier SET min_cents = 50000 WHERE rank = 3;'
    );
  });
});

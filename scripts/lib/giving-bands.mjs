// Works out sensible giving bands from real gift data WITHOUT showing the data.
// Everything here is pure: rows in, aggregate numbers out. Nothing returned or
// printed identifies a person or a single gift, and counts under 3 are hidden.

export const NICE = [
  5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 3000,
  5000, 7500, 10000,
];

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.'’,]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Who a gift belongs to: their email when there is one, else their normalized name. */
export const donorKey = (email, name) => {
  const e = String(email ?? '')
    .toLowerCase()
    .trim();
  return e ? `e:${e}` : norm(name) ? `n:${norm(name)}` : null;
};

const cents = (dollars) => Math.round(Number(dollars) * 100);

// Line items inside a ticket purchase that are really gifts. The sliding-scale tiers
// ("Help Us Help Others", "Help Us Break Even") are ticket prices, and the gift part of
// them cannot be separated, so they count only when asked for.
const GIFT_LINE = /^(additional donation|\(optional\) donation for snacks)$/i;
const SLIDING_LINE = /^help us (help others|break even)$/i;
const DONATION_CAMPAIGN = /donation/i;

/**
 * Gifts from a Zeffy "All payments" export. `header` is the first row, `rows` the rest.
 * Donation campaigns carry the payment's total on one row; ticket purchases carry an
 * amount per line, and only the gift lines count.
 */
export function zeffyGiftRows(header, rows, { includeSliding = false } = {}) {
  const at = (name, nth = 0) => {
    let seen = -1;
    return header.findIndex((h) => h === name && ++seen === nth);
  };
  const col = {
    status: at('Payment Status'),
    campaign: at('Campaign Title'),
    rate: at('Rate Title'),
    item: at('Item Amount'),
    total: at('Total Amount'),
    refund: at('Refund Amount'),
    first: at('First Name'),
    last: at('Last Name'),
    email: at('Email', 0),
    formEmail: at('Email', 1),
    date: at('Payment Date (America/Los_Angeles)'),
    time: at('Payment Time (America/Los_Angeles)'),
    recurring: at('Recurring Status'),
  };
  const counted = { donationPayments: 0, giftLines: 0, slidingLines: 0, slidingExcluded: 0 };
  const out = [];
  const seenLines = new Map(); // payment -> how many lines of each kind, so a repeated line gets its own reference
  for (const r of rows) {
    if (r[col.status] !== 'Succeeded') continue;
    const campaign = String(r[col.campaign] ?? '');
    const rate = String(r[col.rate] ?? '');
    let dollars = null;
    if (DONATION_CAMPAIGN.test(campaign) && r[col.total] != null) {
      dollars = Number(r[col.total]);
      counted.donationPayments++;
    } else if (GIFT_LINE.test(rate) && r[col.item] != null) {
      dollars = Number(r[col.item]);
      counted.giftLines++;
    } else if (SLIDING_LINE.test(rate) && r[col.item] != null) {
      if (includeSliding) {
        dollars = Number(r[col.item]);
        counted.slidingLines++;
      } else counted.slidingExcluded++;
    }
    if (dollars === null || !Number.isFinite(dollars)) continue;
    if (r[col.refund] != null) dollars -= Number(r[col.refund]) || 0;
    const first = r[col.first] ?? '';
    const last = r[col.last] ?? '';
    const email = r[col.email] ?? r[col.formEmail] ?? null;
    const key = donorKey(email, `${first} ${last}`);
    if (!key || !(dollars > 0)) continue;
    const payment = `${r[col.date]}|${r[col.time]}|${first} ${last}`;
    const lineKind = DONATION_CAMPAIGN.test(campaign) ? '' : rate;
    const n = (seenLines.get(`${payment}|${lineKind}`) ?? 0) + 1;
    seenLines.set(`${payment}|${lineKind}`, n);
    out.push({
      key,
      cents: cents(dollars),
      first: String(first),
      last: String(last),
      email: email ? String(email).trim().toLowerCase() : null,
      date: isoDate(r[col.date]),
      campaign: campaign || null,
      recurring: r[col.recurring] ? 1 : 0,
      payment, // identifies one payment; the caller hashes it so no name is stored
      lineRef: lineKind ? `${lineKind}#${n}` : '',
    });
  }
  return { rows: out, counted };
}

/** M/D/YYYY (Zeffy's export) to YYYY-MM-DD. */
export function isoDate(text) {
  const [m, d, y] = String(text ?? '')
    .split('/')
    .map(Number);
  return y && m && d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
}

/** Gifts from a Zeffy "All payments" export, reduced to a donor and an amount. */
export function zeffyGifts(header, rows, options = {}) {
  const { rows: detailed, counted } = zeffyGiftRows(header, rows, options);
  return { gifts: detailed.map((g) => ({ key: g.key, cents: g.cents })), counted };
}

/** Gifts from Cognito donation-form entries (form 24). Only paid, complete entries. */
export function cognitoGifts(entries) {
  const gifts = [];
  let used = 0;
  for (const e of entries) {
    if (e?.Entry?.Status === 'Incomplete') continue;
    if (e?.Order?.PaymentStatus !== 'Paid') continue;
    let dollars = Number(e.Order.AmountPaid ?? e.Order.OrderAmount ?? e.AmountToDonate);
    if (!Number.isFinite(dollars)) continue;
    dollars -= Number(e.Order.RefundAmount) || 0;
    const key = donorKey(e.DonorEmail, e.DonorName?.FirstAndLast);
    if (key && dollars > 0) {
      gifts.push({ key, cents: cents(dollars) });
      used++;
    }
  }
  return { gifts, used };
}

// Gifts under this are almost certainly test payments ($1 checks of the form), not giving.
export const MIN_GIFT_CENTS = 200;

/** Drops gifts below the minimum, and says how many went. */
export function withoutTestGifts(gifts, minCents = MIN_GIFT_CENTS) {
  const kept = gifts.filter((g) => g.cents >= minCents);
  return { gifts: kept, dropped: gifts.length - kept.length };
}

/** Total cents per donor, across every source. */
export function totalsByDonor(...giftLists) {
  const totals = new Map();
  for (const list of giftLists) for (const g of list) totals.set(g.key, (totals.get(g.key) ?? 0) + g.cents);
  return [...totals.values()].filter((c) => c > 0).sort((a, b) => a - b);
}

/**
 * The round dollar figure that puts the share of donors strictly below it closest to
 * `target`. Where several figures tie (a gap in the data), the lowest wins. Choosing
 * by share rather than by quantile keeps a band from emptying when many donors give
 * the same amount.
 */
const cutoffFor = (sorted, target) => {
  let best = NICE[0];
  let bestGap = Infinity;
  for (const n of NICE) {
    const below = sorted.filter((c) => c < n * 100).length / sorted.length;
    const gap = Math.abs(below - target);
    if (gap < bestGap) {
      best = n;
      bestGap = gap;
    }
  }
  return best;
};

/**
 * Pick two cutoffs, in whole dollars, that split donors roughly 50 / 35 / 15 into
 * Small, Medium, and Large, using round numbers. `shares` are the share of donors
 * below each cutoff.
 */
export function proposeBands(totalsCents, { shares = [0.5, 0.85] } = {}) {
  if (totalsCents.length < 6) return null; // too few donors to say anything useful
  const medium = cutoffFor(totalsCents, shares[0]);
  let large = cutoffFor(totalsCents, shares[1]);
  if (large <= medium) large = NICE[Math.min(NICE.length - 1, NICE.indexOf(medium) + 1)];
  return { medium, large };
}

/** How many donors fall in each band for the given cutoffs (in dollars). */
export function bandCounts(totalsCents, { medium, large }) {
  const counts = { small: 0, medium: 0, large: 0 };
  for (const c of totalsCents) {
    if (c >= large * 100) counts.large++;
    else if (c >= medium * 100) counts.medium++;
    else counts.small++;
  }
  return counts;
}

/** Donors at or above each round figure. Small counts are hidden so no one stands out. */
export function reach(totalsCents) {
  return NICE.map((n) => ({ dollars: n, donors: totalsCents.filter((c) => c >= n * 100).length })).filter(
    (r) => r.donors > 0
  );
}

const SMALL_STEPS = [1, 2, 3, 5, 10, 15, 20, 25, 50, 100];

/**
 * How many individual gifts are below each small dollar figure, how many donors have
 * only gifts below it, and how many gifts there are in all. Counts only.
 */
export function giftSizes(gifts, steps = SMALL_STEPS) {
  const byDonor = new Map();
  for (const g of gifts) byDonor.set(g.key, Math.max(byDonor.get(g.key) ?? 0, g.cents));
  return {
    gifts: gifts.length,
    donors: byDonor.size,
    below: steps.map((dollars) => ({
      dollars,
      gifts: gifts.filter((g) => g.cents < dollars * 100).length,
      donorsWithOnlySuch: [...byDonor.values()].filter((max) => max < dollars * 100).length,
    })),
  };
}

export const hideSmall = (n) => (n < 3 ? '<3' : String(n));

/** The statements that set the live tiers. */
export const bandSql = ({ medium, large }) =>
  [
    `UPDATE giving_tier SET min_cents = ${medium * 100} WHERE rank = 2;`,
    `UPDATE giving_tier SET min_cents = ${large * 100} WHERE rank = 3;`,
  ].join('\n');

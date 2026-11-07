import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../../functions/api/track-purchase/cognito.js';
import { planCognitoEvents, parseFormIds } from '../../functions/_lib/cognitoPurchase.js';
import { MP_COLLECT_URL, MP_DEBUG_URL, sendMpEvents, toTimestampMicros } from '../../functions/_lib/ga4.js';

// Fixed "now" so payment dates in fixtures fall inside MP's 72h window.
const NOW = Date.parse('2026-11-07T18:00:00Z');
const PAID_AT = '2026-11-07T17:58:00Z';

type Payload = Record<string, unknown>;

/** A form-131 webhook body shaped like the form's schema (Entry/Order/Form system fields). */
function waEntry(overrides: { action?: string; status?: string; payment?: Partial<Record<string, unknown>> } = {}) {
  return {
    Id: '131-42',
    GAClientId: '1234567890.1700000000',
    GASessionId: '1762538000',
    Form: {
      Id: '131',
      InternalName: '_2026WinterAdventureEventRegistration',
      Name: '2026 Winter Adventure - Event Registration',
    },
    Entry: {
      Action: overrides.action ?? 'Register & Pay!',
      Status: overrides.status ?? 'Submitted',
      DateSubmitted: PAID_AT,
      DateUpdated: PAID_AT,
    },
    Order: {
      Id: 'F-131-42',
      AmountPaid: 1080,
      SubTotal: 1080,
      PaymentStatus: 'Paid',
      PaymentDate: PAID_AT,
      ...overrides.payment,
    },
  } as Payload;
}

function donationEntry(): Payload {
  return {
    Id: '24-7',
    GAClientId: '555.666',
    Form: { Id: '24', InternalName: 'TaxDeductibleDonationToECRS', Name: 'Tax Deductible Donation to ECRS' },
    Entry: { Action: 'Donate now', Status: 'Submitted', DateUpdated: PAID_AT },
    Order: { AmountPaid: 25, PaymentStatus: 'Paid', PaymentDate: PAID_AT },
  };
}

function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
  };
}

const KEY = 'test-key';
function baseEnv(extra: Record<string, unknown> = {}) {
  return {
    TRACK_PURCHASE_KEY: KEY,
    GA4_MEASUREMENT_ID: 'G-TEST',
    GA4_API_SECRET: 'secret',
    WA_FORM_IDS: '131',
    ...extra,
  };
}

function post(body: Payload, env: Record<string, unknown>) {
  const request = new Request(`https://ecrs.org/api/track-purchase/cognito?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return onRequestPost({ request, env } as never) as Promise<Response>;
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Every MP request body sent so far, parsed. */
function sentBodies() {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}
function sentEventNames() {
  return sentBodies().flatMap((b) => b.events.map((e: { name: string }) => e.name));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fetchMock = vi.fn(async (url: string) => {
    const body = String(url).startsWith(MP_DEBUG_URL) ? { validationMessages: [] } : {};
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Cognito purchase webhook', () => {
  it('Register & Pay (paid): sends purchase + wa_purchase with session, form_id, and timestamp', async () => {
    const res = await post(waEntry(), baseEnv({ TRACK_DEDUPE: memoryKv() }));
    expect(res.status).toBe(200);
    expect(sentEventNames()).toEqual(['purchase', 'wa_purchase']);

    const [body] = sentBodies();
    expect(body.client_id).toBe('1234567890.1700000000');
    expect(body.timestamp_micros).toBe(Date.parse(PAID_AT) * 1000);
    for (const event of body.events) {
      expect(event.params).toMatchObject({
        transaction_id: '131-42',
        value: 1080,
        currency: 'USD',
        session_id: '1762538000',
        engagement_time_msec: 1,
        form_id: '131',
      });
      expect(event.params.items[0].item_category).toBe('event_registration');
    }
    expect(String(fetchMock.mock.calls[0][0])).toContain(MP_COLLECT_URL);
  });

  it('Register! (unpaid): sends nothing', async () => {
    const entry = waEntry({
      action: 'Register!',
      status: 'Awaiting Customization',
      payment: { AmountPaid: 0, PaymentStatus: 'Unpaid', PaymentDate: null },
    });
    const res = await post(entry, baseEnv());
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Request Payment (staff moves entry to Awaiting Payment): sends nothing', async () => {
    const entry = waEntry({
      action: 'Request Payment',
      status: 'Awaiting Payment',
      payment: { AmountPaid: 0, PaymentStatus: 'Unpaid', PaymentDate: null },
    });
    await post(entry, baseEnv());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('later Pay action on an Awaiting Payment entry: sends purchase + wa_purchase', async () => {
    const entry = waEntry({ action: 'Pay', status: 'Submitted' });
    await post(entry, baseEnv({ TRACK_DEDUPE: memoryKv() }));
    expect(sentEventNames()).toEqual(['purchase', 'wa_purchase']);
  });

  it('internal Update on a paid entry: sends nothing', async () => {
    const entry = waEntry({ action: 'Update' });
    await post(entry, baseEnv());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stale payment on a later delivery (no KV bound): sends nothing', async () => {
    const entry = waEntry({ action: 'Register & Pay!' });
    (entry.Entry as Payload).DateUpdated = '2026-11-07T17:58:00Z';
    (entry.Order as Payload).PaymentDate = '2026-11-01T12:00:00Z';
    await post(entry, baseEnv());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('non-WA paid form (donation): sends purchase only', async () => {
    await post(donationEntry(), baseEnv());
    expect(sentEventNames()).toEqual(['purchase']);
    const [body] = sentBodies();
    expect(body.events[0].params.items[0].item_category).toBe('donation');
    expect(body.events[0].params.form_id).toBe('24');
    expect(body.events[0].params.session_id).toBeUndefined();
  });

  it('WA form not listed in WA_FORM_IDS: sends purchase only', async () => {
    await post(waEntry(), baseEnv({ WA_FORM_IDS: '' }));
    expect(sentEventNames()).toEqual(['purchase']);
  });

  it('webhook retry (duplicate delivery): second delivery sends nothing', async () => {
    const kv = memoryKv();
    const env = baseEnv({ TRACK_DEDUPE: kv });
    await post(waEntry(), env);
    const retry = await post(waEntry(), env);
    expect(retry.status).toBe(200);
    expect(await retry.text()).toMatch(/Already reported/);
    expect(sentEventNames()).toEqual(['purchase', 'wa_purchase']);
    expect(kv.store.has('cognito:131-42')).toBe(true);
  });

  it('submit then Pay update for the same entry: only the first sends', async () => {
    const env = baseEnv({ TRACK_DEDUPE: memoryKv() });
    await post(waEntry({ action: 'Register & Pay!' }), env);
    await post(waEntry({ action: 'Pay' }), env);
    expect(sentEventNames()).toEqual(['purchase', 'wa_purchase']);
  });

  it('failed GA4 send does not mark the payment, so a Cognito retry can resend', async () => {
    const kv = memoryKv();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    const first = await post(waEntry(), baseEnv({ TRACK_DEDUPE: kv }));
    expect(first.status).toBe(502);
    expect(kv.put).not.toHaveBeenCalled();
    await post(waEntry(), baseEnv({ TRACK_DEDUPE: kv }));
    expect(sentEventNames()).toEqual(['purchase', 'wa_purchase', 'purchase', 'wa_purchase']);
  });

  it('missing GASessionId: still sends, without session_id', async () => {
    const entry = waEntry();
    delete entry.GASessionId;
    await post(entry, baseEnv());
    expect(sentEventNames()).toEqual(['purchase', 'wa_purchase']);
    for (const event of sentBodies()[0].events) {
      expect(event.params).not.toHaveProperty('session_id');
      expect(event.params.engagement_time_msec).toBe(1);
    }
  });

  it('missing GAClientId: falls back to a random client_id', async () => {
    const entry = waEntry();
    entry.GAClientId = '';
    await post(entry, baseEnv());
    expect(sentBodies()[0].client_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GA4_DEBUG=true posts to the validation endpoint and keeps the dedupe key free', async () => {
    const kv = memoryKv();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await post(waEntry(), baseEnv({ GA4_DEBUG: 'true', TRACK_DEDUPE: kv }));
    expect(String(fetchMock.mock.calls[0][0])).toContain(MP_DEBUG_URL);
    expect(kv.put).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[ga4 debug] validationMessages', '[]');
    log.mockRestore();
  });

  it('rejects requests without the shared key', async () => {
    const request = new Request('https://ecrs.org/api/track-purchase/cognito', { method: 'POST', body: '{}' });
    const res = (await onRequestPost({ request, env: baseEnv() } as never)) as Response;
    expect(res.status).toBe(401);
  });

  it('fails loud on a payload with no transaction id', async () => {
    const entry = waEntry();
    delete entry.Id;
    const res = await post(entry, baseEnv());
    expect(res.status).toBe(422);
  });
});

describe('ga4 helpers', () => {
  it('toTimestampMicros only accepts dates inside the last 72 hours', () => {
    expect(toTimestampMicros(PAID_AT, NOW)).toBe(Date.parse(PAID_AT) * 1000);
    expect(toTimestampMicros('2026-11-03T00:00:00Z', NOW)).toBeUndefined();
    expect(toTimestampMicros('2026-11-08T00:00:00Z', NOW)).toBeUndefined();
    expect(toTimestampMicros(null, NOW)).toBeUndefined();
    expect(toTimestampMicros('not a date', NOW)).toBeUndefined();
  });

  it('sendMpEvents with debug never touches the live endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"validationMessages":[]}'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendMpEvents(
      { GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 's' },
      { clientId: 'c', events: [{ name: 'purchase', params: {} }] },
      { debug: true, fetchImpl: fetchImpl as never }
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toMatch(
      /^https:\/\/www\.google-analytics\.com\/debug\/mp\/collect\?/
    );
    log.mockRestore();
  });

  it('parseFormIds handles spaces and blanks', () => {
    expect([...parseFormIds(' 131, 140 ,,')]).toEqual(['131', '140']);
    expect(parseFormIds(undefined).size).toBe(0);
  });

  it('planCognitoEvents treats a missing PaymentStatus as paid (legacy donation behavior)', () => {
    const entry = donationEntry();
    delete (entry.Order as Payload).PaymentStatus;
    const plan = planCognitoEvents(entry, { waFormIds: new Set(['131']), now: NOW });
    expect(plan.events?.map((e: { name: string }) => e.name)).toEqual(['purchase']);
  });
});

describe('GA4 session cookie parser (CognitoForm.astro inline script)', () => {
  // The parser lives in an is:inline script, so pull it out by its markers.
  const src = readFileSync(path.join(__dirname, '../components/widgets/CognitoForm.astro'), 'utf8');
  const fnSrc = src.split('// ga-session-parser:start')[1].split('// ga-session-parser:end')[0];
  const parse = new Function(`${fnSrc}; return parseGaSessionId;`)() as (v: string) => string;

  it('reads the older GS1 format', () => {
    expect(parse('GS1.1.1762538000.3.1.1762539000.0.0.0')).toBe('1762538000');
  });
  it('reads the newer GS2 format', () => {
    expect(parse('GS2.1.s1762538000$o3$g1$t1762539000$j60$l0$h0')).toBe('1762538000');
  });
  it('returns empty for missing or unrecognized values', () => {
    expect(parse('')).toBe('');
    expect(parse('garbage')).toBe('');
    expect(parse('GS2.1.o3$g1')).toBe('');
    expect(parse('GS1.1.abc.3')).toBe('');
  });
});

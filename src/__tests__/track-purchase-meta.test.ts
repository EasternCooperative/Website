import { describe, expect, it, vi } from 'vitest';
import { buildMetaPurchase, sendMetaPurchase, sha256Hex, toEventTime } from '../../functions/_lib/meta.js';
import { planCognitoEvents, applyVisitorIds } from '../../functions/_lib/cognitoPurchase.js';
import { loadVisitorIds, sanitizeVisitorIds } from '../../functions/_lib/visitorIds.js';
import { onRequestPost as trackIds } from '../../functions/api/track-ids.js';

const NOW = Date.parse('2026-11-07T18:00:00Z');
const PAID_AT = '2026-11-07T17:58:00Z';

const purchase = {
  transactionId: '131-42',
  value: 1080,
  currency: 'USD',
  itemName: '2026 Winter Adventure - Event Registration',
  itemCategory: 'event_registration',
  fbp: 'fb.1.1700000000000.1234567890',
  fbc: null,
  email: null,
  paidAt: PAID_AT,
};

const env = { META_PIXEL_ID: '111', META_CAPI_TOKEN: 'tok' };
const okFetch = () => vi.fn(async () => new Response('{}', { status: 200 }));

describe('toEventTime', () => {
  it('uses the payment time when Meta will accept it', () => {
    expect(toEventTime(PAID_AT, NOW)).toBe(Date.parse(PAID_AT) / 1000);
  });

  it('falls back to now for a missing, future, or too-old date', () => {
    const now = Math.floor(NOW / 1000);
    expect(toEventTime(null, NOW)).toBe(now);
    expect(toEventTime('2026-12-01T00:00:00Z', NOW)).toBe(now);
    expect(toEventTime('2026-10-01T00:00:00Z', NOW)).toBe(now);
  });
});

describe('buildMetaPurchase', () => {
  it('carries the value and uses the transaction id for dedupe', async () => {
    const event = await buildMetaPurchase(purchase, NOW);
    expect(event).toMatchObject({
      event_name: 'Purchase',
      event_id: '131-42',
      action_source: 'website',
      user_data: { fbp: purchase.fbp },
      custom_data: { value: 1080, currency: 'USD', order_id: '131-42', content_category: 'event_registration' },
    });
  });

  it('returns null without a browser id, even when an email is known', async () => {
    expect(await buildMetaPurchase({ ...purchase, fbp: null, email: 'a@example.com' }, NOW)).toBeNull();
    expect(await buildMetaPurchase({ ...purchase, fbp: '  ' }, NOW)).toBeNull();
  });

  it('sends the email only as a normalised SHA-256 hash', async () => {
    const event = await buildMetaPurchase({ ...purchase, email: ' Pat@Example.com ' }, NOW);
    const userData = (event as { user_data: { em: string[] } }).user_data;
    expect(userData.em).toEqual([await sha256Hex('pat@example.com')]);
    expect(JSON.stringify(event)).not.toContain('Example.com');
  });
});

describe('sendMetaPurchase', () => {
  it('does nothing until the pixel id and token are configured', async () => {
    const fetchImpl = okFetch();
    expect(await sendMetaPurchase({}, purchase, { fetchImpl })).toBe('not-configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not call Meta when there is no browser id', async () => {
    const fetchImpl = okFetch();
    expect(await sendMetaPurchase(env, { ...purchase, fbp: null }, { fetchImpl })).toBe('no-browser-id');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts the event to the pixel endpoint, with the test code when set', async () => {
    const fetchImpl = okFetch();
    const status = await sendMetaPurchase({ ...env, META_TEST_EVENT_CODE: 'TEST1' }, purchase, { fetchImpl, now: NOW });
    expect(status).toBe('sent');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v[\d.]+\/111\/events\?access_token=tok$/);
    const body = JSON.parse(init.body as string);
    expect(body.test_event_code).toBe('TEST1');
    expect(body.data).toHaveLength(1);
  });

  it('reports a rejection or a network error without throwing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const rejected = vi.fn(async () => new Response('{"error":{}}', { status: 400 }));
    expect(await sendMetaPurchase(env, purchase, { fetchImpl: rejected })).toBe('rejected');
    const broken = vi.fn(async () => {
      throw new Error('network');
    });
    expect(await sendMetaPurchase(env, purchase, { fetchImpl: broken })).toBe('failed');
    vi.restoreAllMocks();
  });
});

describe('visitor ids handed over outside the form', () => {
  const entry = {
    Id: '131-42',
    GAClientId: '1234567890.1700000000',
    Form: { Id: '131', Name: 'WA' },
    Entry: { Action: 'Register & Pay!', DateUpdated: PAID_AT },
    Order: { AmountPaid: 1080, PaymentStatus: 'Paid', PaymentDate: PAID_AT },
  };
  const plan = () => planCognitoEvents(entry, { waFormIds: new Set(['131']), now: NOW });

  it('sanitizeVisitorIds keeps well-formed ids and drops everything else', () => {
    expect(
      sanitizeVisitorIds({
        cid: '123.456',
        sid: '1762538000',
        fbp: 'fb.1.1700000000000.1234567890',
        fbc: 'fb.1.1700000000000.AbC_dEf-123',
        extra: 'ignored',
      })
    ).toEqual({
      clientId: '123.456',
      ids: { sid: '1762538000', fbp: 'fb.1.1700000000000.1234567890', fbc: 'fb.1.1700000000000.AbC_dEf-123' },
    });
    expect(sanitizeVisitorIds({ cid: '123.456', fbp: '<script>' })).toBeNull();
    expect(sanitizeVisitorIds({ cid: 'not-an-id', fbp: 'fb.1.1.2' })).toBeNull();
    expect(sanitizeVisitorIds({ cid: '123.456' })).toBeNull();
    expect(sanitizeVisitorIds('nope')).toBeNull();
  });

  it('the plan carries no Meta ids of its own', () => {
    expect(plan().meta).toMatchObject({ transactionId: '131-42', value: 1080, fbp: null, fbc: null });
  });

  it('applyVisitorIds adds the Meta ids and a missing GA session id', () => {
    const merged = applyVisitorIds(plan(), { sid: '1762538000', fbp: 'fb.1.1.2', fbc: 'fb.1.1.abc' });
    expect(merged.meta).toMatchObject({ fbp: 'fb.1.1.2', fbc: 'fb.1.1.abc' });
    expect(merged.events!.map((e) => e.params.session_id)).toEqual(['1762538000', '1762538000']);
  });

  it('a session id that came with the entry wins over the stored one', () => {
    const withField = planCognitoEvents({ ...entry, GASessionId: '111' }, { waFormIds: new Set(), now: NOW });
    expect(applyVisitorIds(withField, { sid: '999' }).events![0].params.session_id).toBe('111');
  });

  it('track-ids stores under the GA client id and the webhook lookup reads it back', async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => void store.set(k, v),
    };
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      trackIds({
        request: new Request('https://ecrs.org/api/track-ids', {
          method: 'POST',
          headers,
          body: typeof body === 'string' ? body : JSON.stringify(body),
        }),
        env: { TRACK_DEDUPE: kv },
      } as never) as Promise<Response>;

    expect((await post({ cid: '123.456', fbp: 'fb.1.1700000000000.99' })).status).toBe(204);
    expect(await loadVisitorIds(kv, '123.456')).toEqual({ fbp: 'fb.1.1700000000000.99' });

    // junk, another site's page, and an oversized body all store nothing, and answer the same
    store.clear();
    expect((await post('{not json')).status).toBe(204);
    expect((await post({ cid: '123.456', fbp: 'fb.1.1.2' }, { origin: 'https://evil.example' })).status).toBe(204);
    expect((await post({ cid: '123.456', fbp: 'fb.1.1.2', pad: 'x'.repeat(3000) })).status).toBe(204);
    expect(store.size).toBe(0);
    expect(await loadVisitorIds(kv, '123.456')).toEqual({});
    expect(await loadVisitorIds(undefined, '123.456')).toEqual({});
  });
});

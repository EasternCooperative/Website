// Shared helper for Cloudflare Pages Functions under functions/api/track-purchase/.
// Sends GA4 Measurement Protocol events so server-side webhooks (Cognito
// Forms, Zeffy) can report payment value to Google Ads conversion actions
// imported from GA4 on the www.ecrs.org property.
//
// MP reference: https://developers.google.com/analytics/devguides/collection/protocol/ga4
// MP silently drops unknown fields and still returns 2xx. Set the
// GA4_DEBUG=true env var (or pass { debug: true }) to post to the
// validation endpoint instead: nothing reaches the live property and the
// validation messages are logged.

export const MP_COLLECT_URL = 'https://www.google-analytics.com/mp/collect';
export const MP_DEBUG_URL = 'https://www.google-analytics.com/debug/mp/collect';

// MP rejects timestamps more than 72 hours in the past.
const MAX_BACKDATE_MS = 72 * 60 * 60 * 1000;

/**
 * Convert an ISO date string to MP's timestamp_micros, or undefined when the
 * date is missing, unparseable, in the future, or older than MP accepts.
 * @param {string | undefined | null} iso
 * @param {number} [now]
 */
export function toTimestampMicros(iso, now = Date.now()) {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return undefined;
  if (ms > now || now - ms > MAX_BACKDATE_MS) return undefined;
  return ms * 1000;
}

/**
 * Build the params shared by purchase-style events.
 * @param {{transactionId: string, value: number, currency: string, itemName: string, itemCategory: string, itemVariant: string, sessionId?: string | null, formId?: string | null}} purchase
 */
export function purchaseParams(purchase) {
  /** @type {Record<string, unknown>} */
  const params = {
    transaction_id: purchase.transactionId,
    value: purchase.value,
    currency: purchase.currency,
    items: [
      {
        item_name: purchase.itemName,
        item_category: purchase.itemCategory,
        item_variant: purchase.itemVariant,
      },
    ],
    // Without a session_id + engagement time, GA4 can't join the hit to the
    // visitor's session, so it lands as "Unassigned" and never reaches Ads.
    engagement_time_msec: 1,
  };
  if (purchase.sessionId) params.session_id = purchase.sessionId;
  if (purchase.formId) params.form_id = purchase.formId;
  return params;
}

/**
 * Post one MP request carrying one or more events for a single client.
 * @param {{GA4_MEASUREMENT_ID?: string, GA4_API_SECRET?: string, GA4_DEBUG?: string}} env
 * @param {{clientId: string, events: {name: string, params: Record<string, unknown>}[], timestampMicros?: number}} payload
 * @param {{debug?: boolean, fetchImpl?: typeof fetch}} [options]
 */
export async function sendMpEvents(env, payload, options = {}) {
  const measurementId = env.GA4_MEASUREMENT_ID;
  const apiSecret = env.GA4_API_SECRET;
  if (!measurementId || !apiSecret) {
    throw new Error('GA4_MEASUREMENT_ID / GA4_API_SECRET are not configured (Cloudflare Pages env vars)');
  }

  const debug = options.debug ?? env.GA4_DEBUG === 'true';
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = debug ? MP_DEBUG_URL : MP_COLLECT_URL;
  const url = `${base}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

  /** @type {Record<string, unknown>} */
  const body = { client_id: payload.clientId, events: payload.events };
  if (payload.timestampMicros) body.timestamp_micros = payload.timestampMicros;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (debug) {
    let messages = [];
    try {
      messages = (await response.clone().json()).validationMessages ?? [];
    } catch {
      /* debug endpoint always returns JSON; ignore if it somehow doesn't */
    }
    console.log('[ga4 debug] request', JSON.stringify(body));
    console.log('[ga4 debug] validationMessages', JSON.stringify(messages));
  }

  return response;
}

/**
 * Back-compat wrapper: send a single `purchase` event (used by zeffy.js).
 * @param {{GA4_MEASUREMENT_ID?: string, GA4_API_SECRET?: string, GA4_DEBUG?: string}} env
 * @param {{clientId: string, transactionId: string, value: number, currency: string, itemName: string, itemCategory: string, itemVariant: string}} purchase
 */
export function sendPurchaseEvent(env, purchase) {
  return sendMpEvents(env, {
    clientId: purchase.clientId,
    events: [{ name: 'purchase', params: purchaseParams(purchase) }],
  });
}

// GA4's client_id has no dollar-attribution requirement — a random one still
// counts the conversion, it just can't stitch back to the ad click. Used
// when a source (e.g. Zeffy's cross-origin iframe) can't supply the real
// GA4 _ga cookie value.
export function randomClientId() {
  return crypto.randomUUID();
}

/**
 * Checks the `key` query param against the shared secret configured for this
 * endpoint. Cognito/Zeffy webhook configs don't support HMAC signing, so a
 * shared-secret query param is the auth mechanism — without it this is a
 * public POST URL that writes into the Ads account's Primary conversion goal.
 * @param {Request} request
 * @param {{TRACK_PURCHASE_KEY?: string}} env
 */
export function isAuthorized(request, env) {
  if (!env.TRACK_PURCHASE_KEY) return false;
  const url = new URL(request.url);
  return url.searchParams.get('key') === env.TRACK_PURCHASE_KEY;
}

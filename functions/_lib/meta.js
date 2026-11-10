// Shared helper for the purchase webhooks under functions/api/track-purchase/.
// Sends a `Purchase` to Meta's Conversions API so Meta learns what a
// registration or donation was worth. The browser pixel never fires Purchase
// (the payment completes inside Cognito's form), so there is no browser copy
// of the event to deduplicate against; `event_id` still carries the
// transaction id so a retried webhook is collapsed by Meta.
//
// Reference: https://developers.facebook.com/docs/marketing-api/conversions-api
//
// Consent: an event is only sent when the visitor's browser handed us a Meta
// browser id (`_fbp`) or click id (`_fbc`). Those cookies exist only once the
// pixel has loaded, and the pixel only loads for visitors who are allowed to
// be measured (MetaPixel.astro). No cookie, no event.
//
// Env (Cloudflare Pages > Settings > Variables and Secrets):
//   META_PIXEL_ID          the pixel / dataset id (same id as src/config.yaml)
//   META_CAPI_TOKEN        Conversions API access token (secret)
//   META_TEST_EVENT_CODE   optional; routes events to Events Manager > Test events
//   META_API_VERSION       optional; overrides DEFAULT_API_VERSION below

// Graph API versions expire roughly two years after release. Bump this (or set
// META_API_VERSION) if Meta starts rejecting requests with a version error.
export const DEFAULT_API_VERSION = 'v24.0';

// Meta rejects events older than 7 days.
const MAX_BACKDATE_SECONDS = 7 * 24 * 60 * 60;

/** Lowercase hex SHA-256, the form Meta wants hashed identifiers in. */
export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function nonEmpty(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Unix seconds for the event: the payment time when it is recent enough for
 * Meta to accept, otherwise now.
 * @param {string | undefined | null} iso
 * @param {number} [now]
 */
export function toEventTime(iso, now = Date.now()) {
  const nowSeconds = Math.floor(now / 1000);
  const ms = Date.parse(iso ?? '');
  if (Number.isNaN(ms)) return nowSeconds;
  const seconds = Math.floor(ms / 1000);
  if (seconds > nowSeconds || nowSeconds - seconds > MAX_BACKDATE_SECONDS) return nowSeconds;
  return seconds;
}

/**
 * Build the Conversions API event, or null when there is no browser id to
 * attach it to (see the consent note at the top of this file).
 * @param {{transactionId: string, value: number, currency: string, itemName: string, itemCategory: string, fbp?: string | null, fbc?: string | null, email?: string | null, paidAt?: string | null, sourceUrl?: string | null}} purchase
 * @param {number} [now]
 */
export async function buildMetaPurchase(purchase, now = Date.now()) {
  const fbp = nonEmpty(purchase.fbp);
  const fbc = nonEmpty(purchase.fbc);
  if (!fbp && !fbc) return null;

  /** @type {Record<string, unknown>} */
  const userData = {};
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;
  // An email improves Meta's match rate. It is normalised and hashed here;
  // the address itself never leaves this function.
  const email = nonEmpty(purchase.email);
  if (email) userData.em = [await sha256Hex(email.toLowerCase())];

  /** @type {Record<string, unknown>} */
  const event = {
    event_name: 'Purchase',
    event_time: toEventTime(purchase.paidAt, now),
    event_id: purchase.transactionId,
    action_source: 'website',
    user_data: userData,
    custom_data: {
      value: purchase.value,
      currency: purchase.currency,
      content_name: purchase.itemName,
      content_category: purchase.itemCategory,
      order_id: purchase.transactionId,
    },
  };
  const sourceUrl = nonEmpty(purchase.sourceUrl);
  if (sourceUrl) event.event_source_url = sourceUrl;
  return event;
}

/**
 * Send one Purchase to Meta. Resolves to a short status string and never
 * throws: the GA4 send is the webhook's primary job, and a Meta outage or a
 * missing token must not turn a delivered payment into a failed webhook.
 * @param {{META_PIXEL_ID?: string, META_CAPI_TOKEN?: string, META_TEST_EVENT_CODE?: string, META_API_VERSION?: string}} env
 * @param {Parameters<typeof buildMetaPurchase>[0]} purchase
 * @param {{fetchImpl?: typeof fetch, now?: number}} [options]
 * @returns {Promise<'sent' | 'not-configured' | 'no-browser-id' | 'rejected' | 'failed'>}
 */
export async function sendMetaPurchase(env, purchase, options = {}) {
  if (!env.META_PIXEL_ID || !env.META_CAPI_TOKEN) return 'not-configured';

  try {
    const event = await buildMetaPurchase(purchase, options.now);
    if (!event) return 'no-browser-id';

    /** @type {Record<string, unknown>} */
    const body = { data: [event] };
    if (env.META_TEST_EVENT_CODE) body.test_event_code = env.META_TEST_EVENT_CODE;

    const version = env.META_API_VERSION || DEFAULT_API_VERSION;
    const url = `https://graph.facebook.com/${version}/${encodeURIComponent(env.META_PIXEL_ID)}/events?access_token=${encodeURIComponent(env.META_CAPI_TOKEN)}`;
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // Meta's error body names the problem (bad token, expired API version…) and holds no visitor data.
      console.log('[meta capi] rejected', response.status, await response.text().catch(() => ''));
      return 'rejected';
    }
    return 'sent';
  } catch (err) {
    console.log('[meta capi] failed', String(err));
    return 'failed';
  }
}

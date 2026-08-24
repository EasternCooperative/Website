// Shared helper for Cloudflare Pages Functions under functions/api/track-purchase/.
// Sends a GA4 Measurement Protocol `purchase` event so server-side webhooks
// (Cognito Forms, Zeffy) can report donation value to the Google Ads
// "Donation Completed" conversion action, which is imported from GA4's
// `purchase` event on the www.ecrs.org property.
//
// MP reference: https://developers.google.com/analytics/devguides/collection/protocol/ga4
// MP silently drops unknown fields and still returns 2xx — validate any
// payload changes against https://www.google-analytics.com/debug/mp/collect
// (same request shape, returns validation errors) before trusting a 200.

const MP_COLLECT_URL = 'https://www.google-analytics.com/mp/collect';

/**
 * @param {{GA4_MEASUREMENT_ID?: string, GA4_API_SECRET?: string}} env
 * @param {{clientId: string, transactionId: string, value: number, currency: string, itemName: string, itemCategory: string, itemVariant: string}} purchase
 */
export async function sendPurchaseEvent(env, purchase) {
  const measurementId = env.GA4_MEASUREMENT_ID;
  const apiSecret = env.GA4_API_SECRET;
  if (!measurementId || !apiSecret) {
    throw new Error('GA4_MEASUREMENT_ID / GA4_API_SECRET are not configured (Cloudflare Pages env vars)');
  }

  const url = `${MP_COLLECT_URL}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

  const body = {
    client_id: purchase.clientId,
    events: [
      {
        name: 'purchase',
        params: {
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
        },
      },
    ],
  };

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

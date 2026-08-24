// Cloudflare Pages Function — POST /api/track-purchase/zeffy?key=<TRACK_PURCHASE_KEY>
//
// Receives Zeffy's `payment.completed` webhook and forwards it to GA4
// Measurement Protocol as a `purchase` event (see ../../_lib/ga4.js).
//
// UNVERIFIED FIELD MAPPING: this hasn't been checked against a live Zeffy
// webhook delivery. Field names below are best-effort based on Zeffy's
// documented payload description (amount, currency, line items, campaign,
// buyer info) — confirm against a real `payment.completed` payload (Zeffy
// account > Settings > Integrations > Webhooks) and adjust before relying on
// this in production.
//
// Zeffy's form embed is a cross-origin iframe (see ZeffyForm.astro), so the
// site's JS cannot read or set fields inside it. There is no way to prefill
// the GA4 _ga client_id here — every Zeffy purchase uses a random
// client_id, so the conversion counts but never attributes to an ad
// campaign. If per-campaign attribution for Zeffy becomes a priority, it
// would need Zeffy-side support (e.g. a UTM/gclid pass-through param Zeffy
// forwards in its webhook) rather than a site-code fix.

import { sendPurchaseEvent, randomClientId, isAuthorized } from '../../_lib/ga4.js';

function extractAmount(payload) {
  const candidates = [payload.amount, payload.data?.amount, payload.totalAmount, payload.data?.totalAmount];
  const found = candidates.find((v) => typeof v === 'number' && !Number.isNaN(v));
  return found ?? null;
}

function extractCampaignName(payload) {
  return payload.campaignName || payload.data?.campaignName || payload.formName || 'Zeffy Donation';
}

function extractCampaignType(payload) {
  const type = payload.campaignType || payload.data?.campaignType || '';
  return String(type).toLowerCase().includes('event') ? 'event_registration' : 'donation';
}

function extractTransactionId(payload) {
  const id = payload.id ?? payload.transactionId ?? payload.data?.id;
  return id == null ? null : String(id);
}

export const onRequestPost = async (context) => {
  const { request, env } = context;

  if (!isAuthorized(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const transactionId = extractTransactionId(payload);
  if (!transactionId) {
    return new Response('Could not extract a transaction id from payload — check field mapping', { status: 422 });
  }

  const value = extractAmount(payload);
  if (value === null) {
    return new Response('Could not extract a payment amount from payload — check field mapping', { status: 422 });
  }
  if (value === 0) {
    return new Response('No payment amount, skipped', { status: 200 });
  }

  const purchaseResponse = await sendPurchaseEvent(env, {
    clientId: randomClientId(),
    transactionId,
    value,
    currency: payload.currency || payload.data?.currency || 'USD',
    itemName: extractCampaignName(payload),
    itemCategory: extractCampaignType(payload),
    itemVariant: 'zeffy',
  });

  return new Response('OK', { status: purchaseResponse.ok ? 200 : 502 });
};

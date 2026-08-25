// Cloudflare Pages Function — POST /api/track-purchase/zeffy?key=<TRACK_PURCHASE_KEY>
//
// Receives Zeffy's account-wide `payment.completed` webhook and forwards it
// to GA4 Measurement Protocol as a `purchase` event (see ../../_lib/ga4.js).
//
// Field mapping verified 2026-08-25 against a real $1 test donation
// (`campaign_category: "donation"`). Real shape (snake_case, unlike the
// earlier guesses):
//   { id: <webhook delivery id — NOT stable across retries>,
//     type: "payment.completed", data: { id: <payment id, stable>,
//     amount: <integer CENTS>, currency: "usd", status: "succeeded",
//     description, campaign_type: "donation_form",
//     campaign_category: "donation" | presumably "event" for ticketing } }
// Event-registration campaigns haven't been tested — confirm
// campaign_category's actual value for a ticketed event before trusting the
// item_category split.
//
// Zeffy's form embed is a cross-origin iframe (see ZeffyForm.astro), so the
// site's JS cannot read or set fields inside it. There is no way to prefill
// the GA4 _ga client_id here — every Zeffy purchase uses a random
// client_id, so the conversion counts but never attributes to an ad
// campaign.
//
// SIGNATURE VERIFICATION: Zeffy sends a `zeffy-signature: t=<unix seconds>,
// v1=<hex hmac>` header, captured from a real delivery on 2026-08-25. That
// `t=...,v1=...` shape is Stripe's webhook signature format exactly (not
// Svix's, despite the shared `whsec_` secret prefix) — Zeffy likely
// processes payments through Stripe and reused their convention. This
// implements Stripe's documented algorithm (HMAC-SHA256 over
// `{timestamp}.{raw body}`, keyed by the raw secret, constant-time compared
// against v1, 5-minute replay tolerance), inferred from the header shape
// rather than confirmed against Zeffy's own docs (which don't publish
// this). Requires the `?key=` query param too — belt and suspenders.

import { sendPurchaseEvent, randomClientId, isAuthorized } from '../../_lib/ga4.js';

const SIGNATURE_TOLERANCE_SECONDS = 300;

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyZeffySignature(rawBody, header, secret) {
  if (!header || !secret) return false;

  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  return timingSafeEqual(expected, signature);
}

function extractAmount(payload) {
  const cents = payload.data?.amount;
  return typeof cents === 'number' && !Number.isNaN(cents) ? cents / 100 : null;
}

function extractItemName(payload) {
  return payload.data?.description || 'Zeffy Donation';
}

function extractCampaignType(payload) {
  const category = String(payload.data?.campaign_category || '').toLowerCase();
  return category.includes('event') ? 'event_registration' : 'donation';
}

function extractTransactionId(payload) {
  // payload.id is the webhook *delivery* id, which changes on retry —
  // payload.data.id is the payment's own id and stays stable.
  const id = payload.data?.id;
  return id == null ? null : String(id);
}

function isSucceeded(payload) {
  const status = payload.data?.status;
  return status == null || status === 'succeeded';
}

export const onRequestPost = async (context) => {
  const { request, env } = context;

  if (!isAuthorized(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const rawBody = await request.text();
  const signatureValid = await verifyZeffySignature(
    rawBody,
    request.headers.get('zeffy-signature'),
    env.ZEFFY_WEBHOOK_SECRET
  );
  if (!signatureValid) {
    return new Response('Invalid signature', { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
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
  if (value === 0 || !isSucceeded(payload)) {
    return new Response('No completed payment, skipped', { status: 200 });
  }

  const purchaseResponse = await sendPurchaseEvent(env, {
    clientId: randomClientId(),
    transactionId,
    value,
    currency: (payload.data?.currency || 'USD').toUpperCase(),
    itemName: extractItemName(payload),
    itemCategory: extractCampaignType(payload),
    itemVariant: 'zeffy',
  });

  return new Response('OK', { status: purchaseResponse.ok ? 200 : 502 });
};

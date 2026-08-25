// Cloudflare Pages Function — POST /api/track-purchase/cognito?key=<TRACK_PURCHASE_KEY>
//
// Receives Cognito Forms' "Post JSON Data to a Website" webhook on entry
// submission and forwards it to GA4 Measurement Protocol as a `purchase`
// event (see ../../_lib/ga4.js).
//
// Field mapping verified 2026-08-25 against a real $1 test submission on the
// "Tax Deductible Donation to ECRS" form (PayPal). `Order.AmountPaid` and
// `Order.PaymentStatus` are Cognito's system fields for any form with a
// payment component (not custom field names), so this should generalize to
// other Cognito payment forms — but confirm against a real submission before
// trusting a newly added form.
//
// Every conversion uses a random GA4 client_id (no per-campaign ad
// attribution) — the conversion still counts toward the Ads goal. If
// campaign-level attribution is added later (e.g. Cognito's own gclid/GA
// tag), pass it through as `Client_Id` on the entry and read it here.

import { sendPurchaseEvent, randomClientId, isAuthorized } from '../../_lib/ga4.js';

function extractAmount(entry) {
  const candidates = [entry.Order?.AmountPaid, entry.Order?.SubTotal, entry.AmountToDonate];
  const found = candidates.find((v) => typeof v === 'number' && !Number.isNaN(v));
  return found ?? null;
}

function extractTransactionId(entry) {
  const id = entry.Id ?? entry.Order?.OrderId;
  return id == null ? null : String(id);
}

function isPaid(entry) {
  const status = entry.Order?.PaymentStatus;
  // No PaymentStatus at all means this form has no payment component (or the
  // webhook fired on a non-payment event) — let extractAmount's null case
  // catch that. A present-but-non-"Paid" status means payment hasn't
  // completed (pending, failed, refunded) — don't report those.
  return status == null || status === 'Paid';
}

export const onRequestPost = async (context) => {
  const { request, env } = context;

  if (!isAuthorized(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let entry;
  try {
    entry = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const transactionId = extractTransactionId(entry);
  if (!transactionId) {
    // Can't dedupe without a stable id — a wrong/missing key here is a
    // mapping bug, not a legitimate "nothing to report" case. Fail loud
    // rather than silently 200'ing on a payload we can't actually process.
    return new Response('Could not extract a transaction id from payload — check field mapping', { status: 422 });
  }

  const value = extractAmount(entry);
  if (value === null) {
    // Distinct from a genuine $0 entry: none of the candidate amount keys
    // were present at all, which almost always means the mapping is wrong
    // rather than that this entry has no charge.
    return new Response('Could not extract a payment amount from payload — check field mapping', { status: 422 });
  }
  if (value === 0 || !isPaid(entry)) {
    // Genuinely free entry, or payment not yet completed (pending/failed) —
    // nothing to report.
    return new Response('No completed payment, skipped', { status: 200 });
  }

  const purchaseResponse = await sendPurchaseEvent(env, {
    clientId: randomClientId(),
    transactionId,
    value,
    currency: 'USD',
    itemName: entry.Form?.Name || 'Donation',
    itemCategory: 'donation',
    itemVariant: 'cognito_forms',
  });

  return new Response('OK', { status: purchaseResponse.ok ? 200 : 502 });
};

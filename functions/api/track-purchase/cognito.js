// Cloudflare Pages Function — POST /api/track-purchase/cognito?key=<TRACK_PURCHASE_KEY>
//
// Receives Cognito Forms' "Post JSON Data to a Website" webhook on entry
// submission and forwards it to GA4 Measurement Protocol as a `purchase`
// event (see ../../_lib/ga4.js).
//
// UNVERIFIED FIELD MAPPING: this hasn't been checked against a live Cognito
// webhook delivery. Cognito's webhook payload is the raw entry JSON, whose
// field names follow each field's "JSON name" (editable per-field in
// Developer Mode) rather than a fixed schema — the candidate keys below are
// best-effort guesses. Before relying on this, trigger a real submission,
// inspect the payload in Cognito Forms > form > Settings > Webhooks > Logs,
// and adjust extractAmount/extractTransactionId to match.
//
// Every conversion uses a random GA4 client_id (no per-campaign ad
// attribution) — the conversion still counts toward the Ads goal. If
// campaign-level attribution is added later (e.g. Cognito's own gclid/GA
// tag), pass it through as `Client_Id` on the entry and read it here.

import { sendPurchaseEvent, randomClientId, isAuthorized } from '../../_lib/ga4.js';

function extractAmount(entry) {
  const candidates = [entry.PaymentTotal, entry.Total, entry.OrderTotal, entry.Payment_Amount, entry.Amount];
  const found = candidates.find((v) => typeof v === 'number' && !Number.isNaN(v));
  return found ?? null;
}

function extractTransactionId(entry) {
  const id = entry.EntryId ?? entry.Id ?? entry.Number;
  return id == null ? null : String(id);
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
  if (value === 0) {
    // Genuinely free entry (e.g. a non-payment form, or webhook fired before
    // payment completed) — nothing to report.
    return new Response('No payment amount, skipped', { status: 200 });
  }

  const purchaseResponse = await sendPurchaseEvent(env, {
    clientId: randomClientId(),
    transactionId,
    value,
    currency: 'USD',
    itemName: entry.FormName || 'Donation',
    itemCategory: 'donation',
    itemVariant: 'cognito_forms',
  });

  return new Response('OK', { status: purchaseResponse.ok ? 200 : 502 });
};

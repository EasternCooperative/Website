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
// other Cognito payment forms — but confirm against a real submission
// before trusting a newly added form, same as this one was confirmed.
// item_category detection (donation vs. event_registration) is UNVERIFIED —
// see KNOWN_DONATION_FORMS below.
//
// Ad-click attribution: CognitoForm.astro prefills a hidden "GAClientId"
// field from the visitor's real GA4 _ga cookie before submission (that
// cookie's client_id already carries any gclid GA4's own gtag.js associated
// with the visit). If that field is present on the entry, its value is used
// as the GA4 client_id here instead of a random one, so Ads can attribute
// the donation to the ad campaign that drove it. Falls back to a random
// client_id if the field is missing/empty (e.g. consent declined, ad
// blocker, or a form that hasn't had the hidden field added yet) — the
// conversion still counts, it just won't attribute.

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

// Cognito has no built-in "this form is a donation" signal (unlike Zeffy's
// campaign_category) — forms are just forms. The only Cognito form wired to
// this webhook as of 2026-08-25 is the donation form; every other form
// added later is assumed to be an event/ticket registration per the
// original tracking brief. Add a form's InternalName here if that
// assumption stops holding.
const KNOWN_DONATION_FORMS = new Set(['TaxDeductibleDonationToECRS']);

function extractItemCategory(entry) {
  return KNOWN_DONATION_FORMS.has(entry.Form?.InternalName) ? 'donation' : 'event_registration';
}

function extractClientId(entry) {
  return typeof entry.GAClientId === 'string' && entry.GAClientId ? entry.GAClientId : null;
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
    clientId: extractClientId(entry) || randomClientId(),
    transactionId,
    value,
    currency: 'USD',
    itemName: entry.Form?.Name || 'Donation',
    itemCategory: extractItemCategory(entry),
    itemVariant: 'cognito_forms',
  });

  return new Response('OK', { status: purchaseResponse.ok ? 200 : 502 });
};

// Cloudflare Pages Function — POST /api/track-purchase/cognito?key=<TRACK_PURCHASE_KEY>
//
// Receives Cognito Forms' webhook (Submit endpoint, and on forms with a
// pay-later workflow also the Update endpoint) and forwards completed
// payments to GA4 Measurement Protocol (see ../../_lib/ga4.js):
//
//   - `purchase` for every completed payment (donations and registrations)
//   - `wa_purchase` in the same request, only when the form is listed in the
//     WA_FORM_IDS env var (comma-separated Cognito form ids, e.g. "131")
//
// Field mapping verified 2026-08-25 against a real $1 test submission on the
// "Tax Deductible Donation to ECRS" form (PayPal). `Order.AmountPaid` and
// `Order.PaymentStatus` are Cognito's system fields for any form with a
// payment component, so they generalize to other payment forms. The WA
// registration payload (form 131) has NOT been seen yet; the field names
// below come from its schema (Entry.Action, Entry.DateUpdated,
// Order.PaymentDate), so check the first real WA delivery.
//
// Attribution: CognitoForm.astro prefills hidden "GAClientId" and
// "GASessionId" fields from the visitor's _ga and _ga_<stream> cookies.
// client_id + session_id let GA4 join the purchase to the visitor's session
// (and so to the ad click); without session_id GA4 reports the purchase as
// "Unassigned" and Ads never imports it. Missing fields fall back to a
// random client_id with no session: the purchase still counts, unattributed.
//
// "Did a payment complete in THIS delivery?" (see paymentSkipReason in _lib/cognitoPurchase.js):
//   1. Order.PaymentStatus === "Paid" and Order.AmountPaid > 0.
//   2. Entry.Action is not a non-payment action ("Update" is staff editing,
//      "Request Payment" only moves the entry to Awaiting Payment).
//      "Register!" (unpaid path) is already excluded by rule 1.
//   3. If the Update endpoint is on, a staff edit of an already-paid entry
//      could arrive with a stale payment-ish action. Guard: when both
//      Order.PaymentDate and Entry.DateUpdated are present, the payment must
//      have happened within PAYMENT_FRESH_MS of this update.
//
// Meta: the same payment is also sent to Meta's Conversions API as a
// `Purchase` with its value (see ../../_lib/meta.js), when META_PIXEL_ID and
// META_CAPI_TOKEN are set. Meta's browser ids are not form fields: the page
// stores them in the TRACK_DEDUPE KV namespace under the visitor's GA client
// id (POST /api/track-ids, ../../_lib/visitorIds.js) and this handler reads
// them back by the entry's GAClientId. The same lookup supplies the GA
// session id, so a form needs only the one hidden "GAClientId" field;
// "GASessionId" on older forms still works and takes precedence. Without the
// KV binding the lookup, and so the Meta step, is a silent no-op.
//
// Dedupe: GA4 dedupes `purchase` by transaction_id but not custom events.
// When a KV namespace is bound as TRACK_DEDUPE, each payment is recorded
// under `cognito:<transaction_id>` after a successful send, and any later
// delivery for the same payment (webhook retry, submit + update both
// firing, staff edit) sends nothing. Without the binding, rules 2 and 3
// above are the only guard, and a Cognito retry of a delivery we already
// accepted could double-send wa_purchase.

import { sendMpEvents, randomClientId, isAuthorized } from '../../_lib/ga4.js';
import { planCognitoEvents, applyVisitorIds, parseFormIds } from '../../_lib/cognitoPurchase.js';
import { loadVisitorIds } from '../../_lib/visitorIds.js';
import { sendMetaPurchase } from '../../_lib/meta.js';

const DEDUPE_TTL_SECONDS = 400 * 24 * 60 * 60;

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

  const planned = planCognitoEvents(entry, { waFormIds: parseFormIds(env.WA_FORM_IDS) });
  // A wrong/missing key is a mapping bug, not a legitimate "nothing to
  // report" case, so fail loud rather than silently 200.
  if (planned.error) return new Response(planned.error, { status: 422 });
  if (planned.skip) return new Response(`Skipped: ${planned.skip}`, { status: 200 });

  const dedupe = env.TRACK_DEDUPE;
  // Ids the visitor's browser stored under this GAClientId when the form was
  // on screen (POST /api/track-ids): Meta's ids, and the GA session id for
  // forms without a GASessionId field.
  const plan = applyVisitorIds(planned, await loadVisitorIds(dedupe, planned.clientId));
  const dedupeKey = `cognito:${plan.transactionId}`;
  if (dedupe && (await dedupe.get(dedupeKey))) {
    return new Response('Already reported, skipped', { status: 200 });
  }

  const response = await sendMpEvents(env, {
    clientId: plan.clientId || randomClientId(),
    events: plan.events,
    timestampMicros: plan.timestampMicros,
  });

  if (!response.ok) return new Response('GA4 rejected the request', { status: 502 });

  // Debug mode posts to the validation endpoint, so nothing was really sent:
  // don't burn the dedupe key.
  if (dedupe && env.GA4_DEBUG !== 'true') {
    await dedupe.put(dedupeKey, new Date().toISOString(), { expirationTtl: DEDUPE_TTL_SECONDS });
  }

  // Meta gets the same payment through its Conversions API. Runs after the
  // dedupe key is written, so a retried delivery never reaches this line, and
  // its outcome never changes the response: GA4 is the system of record.
  if (env.GA4_DEBUG !== 'true') await sendMetaPurchase(env, plan.meta);

  return new Response('OK', { status: 200 });
};

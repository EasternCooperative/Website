// Pure planning logic for the Cognito purchase webhook
// (functions/api/track-purchase/cognito.js). Kept separate so the route file
// only exports its handler and this can be unit-tested directly. See the
// route file's header for the payload assumptions and the dedupe design.

import { purchaseParams, toTimestampMicros } from './ga4.js';

const NON_PAYMENT_ACTIONS = new Set(['Update', 'Request Payment']);
const PAYMENT_FRESH_MS = 60 * 60 * 1000;

// Cognito has no built-in "this form is a donation" signal (unlike Zeffy's
// campaign_category). Every form not listed here is treated as an
// event/ticket registration.
const KNOWN_DONATION_FORMS = new Set(['TaxDeductibleDonationToECRS']);

export function extractAmount(entry) {
  const candidates = [entry.Order?.AmountPaid, entry.Order?.SubTotal, entry.AmountToDonate];
  const found = candidates.find((v) => typeof v === 'number' && !Number.isNaN(v));
  return found ?? null;
}

export function extractTransactionId(entry) {
  const id = entry.Id ?? entry.Order?.OrderId;
  return id == null ? null : String(id);
}

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function parseFormIds(raw) {
  return new Set(
    String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/**
 * Decide whether this delivery represents a payment that just completed.
 * Returns null when it does, or a short reason string when it doesn't.
 */
export function paymentSkipReason(entry) {
  const status = entry.Order?.PaymentStatus;
  // Legacy behavior kept for the donation form: no PaymentStatus at all is
  // treated as paid (amount check below still applies).
  if (status != null && status !== 'Paid') return `payment status ${status}`;

  const action = entry.Entry?.Action;
  if (action && NON_PAYMENT_ACTIONS.has(action)) return `non-payment action ${action}`;

  const paidAt = Date.parse(entry.Order?.PaymentDate ?? '');
  const updatedAt = Date.parse(entry.Entry?.DateUpdated ?? '');
  if (!Number.isNaN(paidAt) && !Number.isNaN(updatedAt) && updatedAt - paidAt > PAYMENT_FRESH_MS) {
    return 'payment predates this update';
  }
  return null;
}

/**
 * Pure planning step: which MP events (if any) this entry should produce.
 * @param {any} entry Cognito webhook JSON
 * @param {{waFormIds: Set<string>, now?: number}} config
 */
export function planCognitoEvents(entry, { waFormIds, now = Date.now() }) {
  const transactionId = extractTransactionId(entry);
  if (!transactionId) return { error: 'Could not extract a transaction id from payload — check field mapping' };

  const value = extractAmount(entry);
  if (value === null) return { error: 'Could not extract a payment amount from payload — check field mapping' };
  if (value <= 0) return { skip: 'no amount paid' };

  const reason = paymentSkipReason(entry);
  if (reason) return { skip: reason };

  const formId = entry.Form?.Id != null ? String(entry.Form.Id) : null;
  const params = purchaseParams({
    transactionId,
    value,
    currency: 'USD',
    itemName: entry.Form?.Name || 'Donation',
    itemCategory: KNOWN_DONATION_FORMS.has(entry.Form?.InternalName) ? 'donation' : 'event_registration',
    itemVariant: 'cognito_forms',
    sessionId: nonEmptyString(entry.GASessionId),
    formId,
  });

  const events = [{ name: 'purchase', params }];
  if (formId && waFormIds.has(formId)) events.push({ name: 'wa_purchase', params: { ...params } });

  return {
    transactionId,
    // For Meta's Conversions API (see _lib/meta.js). FBP / FBC are hidden
    // fields CognitoForm.astro prefills from the visitor's _fbp / _fbc
    // cookies; a form without them simply sends nothing to Meta.
    meta: {
      transactionId,
      value,
      currency: 'USD',
      itemName: params.items[0].item_name,
      itemCategory: params.items[0].item_category,
      fbp: nonEmptyString(entry.FBP),
      fbc: nonEmptyString(entry.FBC),
      email: nonEmptyString(entry.Email),
      paidAt: entry.Order?.PaymentDate ?? null,
    },
    clientId: nonEmptyString(entry.GAClientId),
    timestampMicros: toTimestampMicros(entry.Order?.PaymentDate, now),
    events,
  };
}

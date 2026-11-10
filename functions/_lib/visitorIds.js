// Visitor tracking ids, handed from the browser to the purchase webhook
// without going through the form.
//
// A Cognito form can only carry what it has a field for, and adding a hidden
// field per id to every form does not scale. Each payment form already has
// one: "GAClientId". So the page posts the visitor's other ids here, keyed by
// that client id (POST /api/track-ids, see CognitoForm.astro), and when the
// payment webhook arrives with the same GAClientId it reads them back.
//
// Stored in the TRACK_DEDUPE KV namespace under `ids:<ga client id>`.

export const IDS_PREFIX = 'ids:';
// Long enough to cover someone who opens a form, then pays days later.
export const IDS_TTL_SECONDS = 30 * 24 * 60 * 60;

// Shapes are checked strictly: this is a public endpoint that writes to KV,
// so it only ever stores values that look exactly like the cookies it is for.
const GA_CLIENT_ID = /^\d{1,20}\.\d{1,20}$/;
const GA_SESSION_ID = /^\d{1,20}$/;
const FBP = /^fb\.\d\.\d{1,20}\.\d{1,30}$/;
const FBC = /^fb\.\d\.\d{1,20}\.[A-Za-z0-9_-]{1,500}$/;

function match(value, pattern) {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

/**
 * Validate a posted body. Returns null unless it has a well-formed GA client
 * id and at least one other id worth storing.
 * @param {unknown} body
 * @returns {{clientId: string, ids: {sid?: string, fbp?: string, fbc?: string}} | null}
 */
export function sanitizeVisitorIds(body) {
  if (!body || typeof body !== 'object') return null;
  const b = /** @type {Record<string, unknown>} */ (body);
  const clientId = match(b.cid, GA_CLIENT_ID);
  if (!clientId) return null;

  /** @type {{sid?: string, fbp?: string, fbc?: string}} */
  const ids = {};
  const sid = match(b.sid, GA_SESSION_ID);
  const fbp = match(b.fbp, FBP);
  const fbc = match(b.fbc, FBC);
  if (sid) ids.sid = sid;
  if (fbp) ids.fbp = fbp;
  if (fbc) ids.fbc = fbc;
  return Object.keys(ids).length > 0 ? { clientId, ids } : null;
}

/**
 * Read back the ids stored for a GA client id. Never throws: a KV hiccup
 * just means the purchase is reported with what the form itself carried.
 * @param {{get: (key: string) => Promise<string | null>} | undefined} kv
 * @param {string | null | undefined} clientId
 * @returns {Promise<{sid?: string, fbp?: string, fbc?: string}>}
 */
export async function loadVisitorIds(kv, clientId) {
  if (!kv || !clientId || !GA_CLIENT_ID.test(clientId)) return {};
  try {
    const raw = await kv.get(IDS_PREFIX + clientId);
    const parsed = raw ? JSON.parse(raw) : null;
    return sanitizeVisitorIds({ cid: clientId, ...parsed })?.ids ?? {};
  } catch {
    return {};
  }
}

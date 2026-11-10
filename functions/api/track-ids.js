// Cloudflare Pages Function — POST /api/track-ids
//
// The page showing a Cognito form posts the visitor's tracking ids here so the
// purchase webhook can find them later by GA client id. See
// ../_lib/visitorIds.js for why, and CognitoForm.astro for the caller.
//
// Body: { cid: <GA client id>, sid?: <GA session id>, fbp?: <_fbp>, fbc?: <_fbc> }
//
// Always answers 204, whether or not anything was stored: the caller is a
// fire-and-forget beacon, and a distinct error would only help someone probe
// the endpoint. It stores nothing without the TRACK_DEDUPE KV binding.

import { IDS_PREFIX, IDS_TTL_SECONDS, sanitizeVisitorIds } from '../_lib/visitorIds.js';

const MAX_BODY_BYTES = 2048;
const done = () => new Response(null, { status: 204 });

export const onRequestPost = async ({ request, env }) => {
  const kv = env.TRACK_DEDUPE;
  if (!kv) return done();

  // Same-origin pages only. A browser always sends Origin on a cross-site POST.
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return done();

  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return done();
    body = JSON.parse(text);
  } catch {
    return done();
  }

  const clean = sanitizeVisitorIds(body);
  if (!clean) return done();

  try {
    await kv.put(IDS_PREFIX + clean.clientId, JSON.stringify(clean.ids), { expirationTtl: IDS_TTL_SECONDS });
  } catch {
    /* best effort */
  }
  return done();
};

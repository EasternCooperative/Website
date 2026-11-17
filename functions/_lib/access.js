// Cloudflare Access JWT verification for internal Pages Functions.
//
// The Access application in front of ecrs.org does NOT cover the *.pages.dev
// hostnames, and the same Functions and bindings run there. So the Function
// itself is the real gate: every request must carry a valid Access JWT
// (Cf-Access-Jwt-Assertion) for this application, or it is refused. The check
// fails closed. Missing configuration is a 503, never "allow".
//
// Env vars (set in the Pages dashboard):
//   ACCESS_TEAM_DOMAIN  e.g. "ecrs.cloudflareaccess.com" (no scheme)
//   ACCESS_AUD          the AUD tag of the leadership Access application
//   DEV_AUTH_EMAIL      local development only; honored solely on localhost

const CERTS_TTL_MS = 10 * 60 * 1000;
let certsCache = null; // { url, keys, fetchedAt }

const b64urlToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const decodeJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

const getKeys = async (teamDomain, fetchImpl) => {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const now = Date.now();
  if (certsCache && certsCache.url === url && now - certsCache.fetchedAt < CERTS_TTL_MS) return certsCache.keys;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`certs fetch failed: ${res.status}`);
  const { keys } = await res.json();
  certsCache = { url, keys, fetchedAt: now };
  return keys;
};

/** Test hook: forget cached signing keys. */
export const resetCertsCache = () => {
  certsCache = null;
};

/**
 * Verify an Access JWT. Returns the payload, or throws.
 * Only RS256 is accepted.
 */
export const verifyAccessJwt = async (token, { teamDomain, aud, fetchImpl = fetch, now = Date.now() }) => {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (header.alg !== 'RS256') throw new Error('unsupported alg');

  const keys = await getKeys(teamDomain, fetchImpl);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key');

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
    'verify',
  ]);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!ok) throw new Error('bad signature');

  if (payload.iss !== `https://${teamDomain}`) throw new Error('bad issuer');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error('bad audience');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) throw new Error('expired');
  if (typeof payload.nbf === 'number' && payload.nbf * 1000 > now + 60_000) throw new Error('not yet valid');
  if (typeof payload.email !== 'string' || !payload.email) throw new Error('no email');
  return payload;
};

const isLocalhost = (request) => {
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1';
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * Authenticate a request. Returns `{ email }` on success, or `{ response }`
 * (a ready 401/403/503 Response) on failure. Never allows by default.
 */
export const authenticate = async (request, env, opts = {}) => {
  // Local development only, and only when the request really is on localhost.
  if (env.DEV_AUTH_EMAIL && isLocalhost(request)) return { email: env.DEV_AUTH_EMAIL };

  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!teamDomain || !aud) return { response: json(503, { error: 'auth not configured' }) };

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { response: json(401, { error: 'unauthorized' }) };

  try {
    const payload = await verifyAccessJwt(token, { teamDomain, aud, ...opts });
    return { email: payload.email.toLowerCase() };
  } catch {
    return { response: json(401, { error: 'unauthorized' }) };
  }
};

/** Writes must come from this site. Browsers always send Origin on cross-site POST/PUT/DELETE. */
export const sameOriginWrite = (request) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
  const origin = request.headers.get('origin');
  return !!origin && origin === new URL(request.url).origin;
};

export { json };

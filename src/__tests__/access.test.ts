import { beforeEach, describe, expect, it } from 'vitest';
import { authenticate, resetCertsCache, sameOriginWrite, verifyAccessJwt } from '../../functions/_lib/access.js';

const TEAM = 'example.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const NOW = Date.parse('2026-11-16T12:00:00Z');

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

async function makeKey(kid = 'k1') {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid, alg: 'RS256' };
  return { privateKey: pair.privateKey, jwk };
}

async function sign(
  privateKey: CryptoKey,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }
) {
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

const goodPayload = (over: Record<string, unknown> = {}) => ({
  iss: `https://${TEAM}`,
  aud: [AUD],
  email: 'Board@Example.org',
  exp: NOW / 1000 + 3600,
  ...over,
});

const certsFetch = (keys: unknown[]) => async () => new Response(JSON.stringify({ keys }), { status: 200 });

describe('verifyAccessJwt', () => {
  beforeEach(() => resetCertsCache());

  it('accepts a valid token', async () => {
    const { privateKey, jwk } = await makeKey();
    const token = await sign(privateKey, goodPayload());
    const payload = await verifyAccessJwt(token, {
      teamDomain: TEAM,
      aud: AUD,
      fetchImpl: certsFetch([jwk]),
      now: NOW,
    });
    expect(payload.email).toBe('Board@Example.org');
  });

  it.each([
    ['expired', { exp: NOW / 1000 - 10 }],
    ['wrong audience', { aud: ['other'] }],
    ['wrong issuer', { iss: 'https://evil.cloudflareaccess.com' }],
    ['missing email', { email: undefined }],
  ])('rejects %s', async (_name, over) => {
    const { privateKey, jwk } = await makeKey();
    const token = await sign(privateKey, goodPayload(over));
    await expect(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchImpl: certsFetch([jwk]), now: NOW })
    ).rejects.toThrow();
  });

  it('rejects a token signed by a different key', async () => {
    const real = await makeKey();
    const attacker = await makeKey();
    const token = await sign(attacker.privateKey, goodPayload());
    await expect(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchImpl: certsFetch([real.jwk]), now: NOW })
    ).rejects.toThrow('bad signature');
  });

  it('rejects a non-RS256 algorithm and malformed tokens', async () => {
    const { privateKey, jwk } = await makeKey();
    const none = await sign(privateKey, goodPayload(), { alg: 'none', kid: 'k1' });
    const opts = { teamDomain: TEAM, aud: AUD, fetchImpl: certsFetch([jwk]), now: NOW };
    await expect(verifyAccessJwt(none, opts)).rejects.toThrow('unsupported alg');
    await expect(verifyAccessJwt('not.a.jwt.at.all', opts)).rejects.toThrow('malformed');
  });

  it('rejects an unknown kid', async () => {
    const { privateKey, jwk } = await makeKey('other');
    const token = await sign(privateKey, goodPayload());
    await expect(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, fetchImpl: certsFetch([jwk]), now: NOW })
    ).rejects.toThrow('unknown key');
  });
});

describe('authenticate', () => {
  beforeEach(() => resetCertsCache());
  const req = (url = 'https://ecrs.org/api/internal/leadership/bootstrap', headers: Record<string, string> = {}) =>
    new Request(url, { headers });

  it('fails closed (503) when Access is not configured', async () => {
    const out = await authenticate(req(), {});
    expect(out.response?.status).toBe(503);
  });

  it('401s without a token', async () => {
    const out = await authenticate(req(), { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD });
    expect(out.response?.status).toBe(401);
  });

  it('401s on a bad token', async () => {
    const out = await authenticate(req(undefined, { 'cf-access-jwt-assertion': 'garbage' }), {
      ACCESS_TEAM_DOMAIN: TEAM,
      ACCESS_AUD: AUD,
    });
    expect(out.response?.status).toBe(401);
  });

  it('returns the lower-cased email for a good token', async () => {
    const { privateKey, jwk } = await makeKey();
    const token = await sign(privateKey, goodPayload({ exp: Date.now() / 1000 + 3600 }));
    const out = await authenticate(
      req(undefined, { 'cf-access-jwt-assertion': token }),
      { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD },
      { fetchImpl: certsFetch([jwk]) }
    );
    expect(out.email).toBe('board@example.org');
  });

  it('honors DEV_AUTH_EMAIL on localhost only', async () => {
    const env = { DEV_AUTH_EMAIL: 'dev@example.org' };
    expect((await authenticate(req('http://localhost:8788/x'), env)).email).toBe('dev@example.org');
    const prod = await authenticate(req('https://ecrs.org/x'), env);
    expect(prod.email).toBeUndefined();
    expect(prod.response?.status).toBe(503);
  });
});

describe('sameOriginWrite', () => {
  const mk = (method: string, origin?: string) =>
    new Request('https://ecrs.org/api/x', { method, headers: origin ? { origin } : {} });

  it('allows reads and same-origin writes only', () => {
    expect(sameOriginWrite(mk('GET'))).toBe(true);
    expect(sameOriginWrite(mk('POST', 'https://ecrs.org'))).toBe(true);
    expect(sameOriginWrite(mk('POST', 'https://evil.example'))).toBe(false);
    expect(sameOriginWrite(mk('POST'))).toBe(false);
  });
});

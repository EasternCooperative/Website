// One Cognito GET with a timeout and backoff, shared by the scripts that read the API.
// Returns the parsed body, or null for a 404 (an entry number with nothing there).

import { budget as shared } from './cognito-budget.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} token the Cognito API key
 * @param {{ fetchImpl?: typeof fetch, wait?: (ms: number) => Promise<unknown>, budget?: { spend(): void } }} [options]
 */
export function makeGet(token, { fetchImpl = fetch, wait = sleep, budget = shared } = {}) {
  return async (path) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      let res;
      budget.spend(); // every attempt counts, and a run stops before it crosses a cap
      try {
        res = await fetchImpl(`https://www.cognitoforms.com/api${path}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30_000), // a hung request must not stall the whole run
        });
      } catch {
        await wait(1000 * (attempt + 1));
        continue;
      }
      if (res.status === 404) return null;
      if (res.status === 429) {
        const header = res.headers.get('Retry-After') ?? '';
        const asked = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
        await wait(Math.min(60_000, Math.max(Number.isFinite(asked) ? asked : 0, 1000 * 2 ** attempt)));
        continue;
      }
      if (!res.ok) throw new Error(`Cognito API ${res.status}`);
      return res.json();
    }
    throw new Error('Cognito API kept failing or rate-limiting');
  };
}

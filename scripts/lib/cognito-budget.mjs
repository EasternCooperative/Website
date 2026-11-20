// A hard stop on Cognito API requests. The plan includes 10,000 requests a month and bills
// $20 per 100,000 beyond that, and the scripts that read entries make one request per
// entry number, so a careless run can spend thousands. Every request counts here, retries
// included, in a ledger that survives between runs, and a run stops before it crosses a cap.
//
//   COGNITO_MAX_REQUESTS   most requests one run may make (default 300)
//   COGNITO_MONTH_CAP      most requests per calendar month across runs (default 6,000)
//
// Raising either is a deliberate act: say how many you expect to need.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_LEDGER = path.join(os.homedir(), '.config/ecrs/cognito-usage.json');

export function makeBudget({ file = DEFAULT_LEDGER, env = process.env, now = () => new Date() } = {}) {
  const perRun = Number(env.COGNITO_MAX_REQUESTS) || 300;
  const monthCap = Number(env.COGNITO_MONTH_CAP) || 6000;
  let thisRun = 0;
  const month = () => now().toISOString().slice(0, 7);
  const read = () => {
    try {
      const l = JSON.parse(readFileSync(file, 'utf8'));
      return l.month === month() ? l.count : 0;
    } catch {
      return 0;
    }
  };
  return {
    /** Counts one request, or throws before making it if a cap would be crossed. */
    spend() {
      const used = read();
      if (thisRun >= perRun)
        throw new Error(
          `Stopped: this run has made ${thisRun} Cognito requests (limit ${perRun}). Cognito bills beyond 10,000 a month. Set COGNITO_MAX_REQUESTS to allow more, deliberately.`
        );
      if (used >= monthCap)
        throw new Error(
          `Stopped: ${used} Cognito requests recorded this month (cap ${monthCap}). Cognito bills beyond 10,000 a month. Set COGNITO_MONTH_CAP to allow more, deliberately.`
        );
      thisRun++;
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, JSON.stringify({ month: month(), count: used + 1 }), { mode: 0o600 });
    },
    get used() {
      return { run: thisRun, month: read() };
    },
  };
}

/** The budget every script shares. */
export const budget = makeBudget();

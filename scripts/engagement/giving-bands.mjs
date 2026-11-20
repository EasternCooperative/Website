#!/usr/bin/env node
// Works out giving bands from real gifts, and prints only aggregates.
//
//   node scripts/engagement/giving-bands.mjs --zeffy ~/Downloads/All_payments_<date>.xlsx
//
// Reads the Zeffy "All payments" export and the Cognito donation form (24, through the
// API, held in memory only). It prints counts by round dollar figure and the proposed
// cutoffs. It never prints a name, an email, or a single gift, and counts under 3 are
// hidden. It writes only the cutoffs and band sizes to the private folder (no per-person
// data), plus the SQL that would set them. Nothing is sent to the database.
//
// Options: --include-sliding   also count the "Help Us Help Others" / "Help Us Break Even" ticket tiers as gifts
//          --cognito-form 24   the Cognito donation form id
//          --out <dir>         default ~/Documents/ECRS/engagement-export

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { makeGet } from '../lib/cognito-api.mjs';
import {
  bandCounts,
  bandSql,
  cognitoGifts,
  giftSizes,
  hideSmall,
  proposeBands,
  reach,
  totalsByDonor,
  withoutTestGifts,
  zeffyGifts,
} from '../lib/giving-bands.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const home = os.homedir();
const expand = (p) => (p?.startsWith('~') ? path.join(home, p.slice(1)) : p);

const zeffyPath = expand(opt('zeffy'));
const formId = opt('cognito-form', '24');
const outDir = expand(opt('out', '~/Documents/ECRS/engagement-export'));
if (!zeffyPath) {
  console.error('Usage: giving-bands.mjs --zeffy <All_payments export.xlsx> [--include-sliding]');
  process.exit(2);
}

// ---- Cognito donations, in memory ----
const token =
  process.env.COGNITO_API_KEY ?? readFileSync(path.join(home, '.config/ecrs/cognito-api.key'), 'utf8').trim();
const cognitoGet = makeGet(token); // counts every request against the monthly budget
async function cognitoEntries() {
  const entries = [];
  for (let n = 1; ; n += 10) {
    const batch = await Promise.all(
      Array.from({ length: 10 }, (_, i) => cognitoGet(`/forms/${formId}/entries/${n + i}`))
    );
    entries.push(...batch.filter(Boolean));
    if (batch.every((b) => !b)) return entries;
  }
}

const [header, ...rows] = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(zeffyPath)).Sheets.Export, {
  header: 1,
  raw: true,
  defval: null,
});
const zeffy = zeffyGifts(header, rows, { includeSliding: flag('include-sliding') });
const entries = await cognitoEntries();
const cognito = cognitoGifts(entries);
const real = withoutTestGifts([...zeffy.gifts, ...cognito.gifts]);
const totals = totalsByDonor(real.gifts);

console.log('Sources counted');
console.log(`  Zeffy donation payments:        ${zeffy.counted.donationPayments}`);
console.log(`  Zeffy gift lines in tickets:    ${zeffy.counted.giftLines}  ("Additional donation", snack donation)`);
console.log(
  flag('include-sliding')
    ? `  Zeffy sliding-scale lines:      ${zeffy.counted.slidingLines}  (counted as gifts, --include-sliding)`
    : `  Zeffy sliding-scale lines:      ${zeffy.counted.slidingExcluded}  (NOT counted: treated as ticket prices; use --include-sliding to count them)`
);
console.log(`  Cognito donation entries:       ${cognito.used} paid of ${entries.length}`);
console.log(`  Dropped as likely test payments (under $2): ${real.dropped}`);
console.log(`  Not counted: optional donation fields inside registrations, QuickBooks, cash and checks.`);
console.log(`\nDonors with a gift: ${totals.length}`);

if (totals.length) {
  console.log('\nDonors giving at least (all-time total per donor)');
  for (const r of reach(totals)) console.log(`  $${String(r.dollars).padStart(6)}  ${hideSmall(r.donors).padStart(4)}`);
}

const sizes = giftSizes(real.gifts);
console.log(`\nIndividual gifts: ${sizes.gifts} from ${sizes.donors} donors. How many are small?`);
console.log('  Below    gifts   share   donors whose every gift is below it');
for (const b of sizes.below) {
  const share = `${Math.round((b.gifts / sizes.gifts) * 100)}%`;
  console.log(
    `  $${String(b.dollars).padStart(4)}   ${hideSmall(b.gifts).padStart(5)}   ${share.padStart(5)}   ${hideSmall(b.donorsWithOnlySuch)}`
  );
}

const bands = proposeBands(totals);
if (!bands) {
  console.log('\nToo few donors to propose bands.');
  process.exit(0);
}
const counts = bandCounts(totals, bands);
console.log('\nProposed bands (aiming for about 50% / 35% / 15% of donors)');
console.log(`  Small   $1 to $${bands.medium - 0.01}   ${hideSmall(counts.small)} donors`);
console.log(`  Medium  $${bands.medium} to $${bands.large - 0.01}   ${hideSmall(counts.medium)} donors`);
console.log(`  Large   $${bands.large} and up   ${hideSmall(counts.large)} donors`);

mkdirSync(outDir, { recursive: true, mode: 0o700 });
writeFileSync(
  path.join(outDir, 'giving-bands.json'),
  JSON.stringify({ madeAt: new Date().toISOString(), cutoffsDollars: bands, donors: totals.length }, null, 2),
  { mode: 0o600 }
);
writeFileSync(path.join(outDir, 'giving-bands.sql'), `${bandSql(bands)}\n`, { mode: 0o600 });
console.log(`\nWrote cutoffs only (no per-person data) to ${outDir}/giving-bands.json and giving-bands.sql`);
console.log('Nothing was sent to the database.');

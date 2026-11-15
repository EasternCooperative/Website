// Renders each /events/<id>/schedule page from a completed `dist/` build to a
// static PDF at public/schedules/<id>.pdf, using headless Chrome so the output
// matches the browser's own print of that page (fonts, vertical centring, the
// print stylesheet). Run in CI after `npm run build`; the workflow commits any
// changed PDFs back to the repo, and Cloudflare Pages serves them as-is.
//
//   node scripts/render-schedule-pdfs.mjs
//
// Requires: a `dist/` directory, and `npx playwright install chromium`.

import { chromium } from '@playwright/test';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { serveDist } from './lib/serve-dist.mjs';

const DIST = 'dist';
const OUT_DIR = 'public/schedules';
const PORT = 4319;

const server = await serveDist(DIST, PORT);

// Every event that has a rendered schedule page (getStaticPaths already filtered
// to events with a complete `schedule` block + rooms).
const eventsDir = join(DIST, 'events');
const ids = [];
// Covers both build formats: `<id>/schedule.html` (build.format: 'file') and
// `<id>/schedule/index.html` (directory).
for (const entry of await readdir(eventsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join(eventsDir, entry.name);
  if (existsSync(join(dir, 'schedule.html')) || existsSync(join(dir, 'schedule', 'index.html'))) {
    ids.push(entry.name);
  }
}
ids.sort();

// Chrome writes one uncompressed `/Type /Page` dictionary per page.
const pageCount = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;

// Largest print scale that keeps the schedule on one page, so text grows to fill
// whatever space the event's grid leaves. Binary search over Playwright's
// `scale` (valid range 0.1-2); falls back to the smallest tried if nothing fits.
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
async function renderToFit(page) {
  const render = (scale) => page.pdf({ printBackground: true, preferCSSPageSize: true, scale });
  const atMax = await render(MAX_SCALE);
  if (pageCount(atMax) <= 1) return stretchToFill(page, { pdf: atMax, scale: MAX_SCALE }, render);
  let lo = MIN_SCALE;
  let hi = MAX_SCALE;
  let best = { pdf: await render(lo), scale: lo };
  while (hi - lo > 0.01) {
    const mid = (lo + hi) / 2;
    const pdf = await render(mid);
    if (pageCount(pdf) <= 1) {
      best = { pdf, scale: mid };
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return stretchToFill(page, best, render);
}

// After the scale is set, grow the table's height (the extra is shared across
// its rows) until it reaches the bottom margin, so the grid fills the page.
async function stretchToFill(page, best, render) {
  const setHeight = (px) =>
    page.evaluate((h) => {
      document.querySelector('table.schedule-grid').style.height = h ? `${h}px` : '';
    }, px);
  const natural = await page.evaluate(() => document.querySelector('table.schedule-grid').offsetHeight);
  let lo = natural;
  let hi = natural * 2;
  let pdf = best.pdf;
  while (hi - lo > 2) {
    const mid = Math.round((lo + hi) / 2);
    await setHeight(mid);
    const candidate = await render(best.scale);
    if (pageCount(candidate) <= 1) {
      pdf = candidate;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  await setHeight(0);
  return { pdf, scale: best.scale };
}

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  for (const id of ids) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/events/${id}/schedule`, { waitUntil: 'load' });
    await page.waitForSelector('table.schedule-grid');
    const { pdf, scale } = await renderToFit(page);
    await writeFile(join(OUT_DIR, `${id}.pdf`), pdf);
    await page.close();
    console.log(`  ${id}.pdf  (${(pdf.length / 1024).toFixed(0)} KB, scale ${scale.toFixed(2)})`);
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`Rendered ${ids.length} schedule PDF${ids.length === 1 ? '' : 's'}.`);

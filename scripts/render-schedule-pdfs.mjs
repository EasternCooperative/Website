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
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

const DIST = 'dist';
const OUT_DIR = 'public/schedules';
const PORT = 4319;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

if (!existsSync(DIST)) {
  console.error(`No ${DIST}/ directory — run \`npm run build\` first.`);
  process.exit(1);
}

// Walk dist/ once and map every servable URL path to its on-disk file. The
// request handler then only ever does `routes.get(...)`, so the path handed to
// `readFile` originates from this filesystem walk, never from the request —
// there is no request-controlled path expression to traverse out of dist/.
const routes = new Map();
async function indexDir(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await indexDir(abs);
      continue;
    }
    const url = '/' + relative(DIST, abs).split(sep).join('/');
    routes.set(url, abs);
    if (url.endsWith('/index.html')) {
      const base = url.slice(0, -'index.html'.length); // ".../"
      routes.set(base, abs);
      routes.set(base.slice(0, -1), abs); // ".../" without the trailing slash
    } else if (url.endsWith('.html')) {
      routes.set(url.slice(0, -'.html'.length), abs); // extensionless
    }
  }
}
await indexDir(DIST);

// Minimal static file server over the pre-built route map.
const server = createServer(async (req, res) => {
  try {
    const key = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = routes.get(key) ?? routes.get(key.replace(/\/$/, '')) ?? routes.get(`${key}/`);
    if (!file) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

// Every event that has a rendered schedule page (getStaticPaths already filtered
// to events with a complete `schedule` block + rooms).
const eventsDir = join(DIST, 'events');
const ids = [];
for (const entry of await readdir(eventsDir, { withFileTypes: true })) {
  if (entry.isDirectory() && existsSync(join(eventsDir, entry.name, 'schedule', 'index.html'))) {
    ids.push(entry.name);
  }
}
ids.sort();

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  for (const id of ids) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/events/${id}/schedule`, { waitUntil: 'load' });
    await page.waitForSelector('table.schedule-grid');
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    await writeFile(join(OUT_DIR, `${id}.pdf`), pdf);
    await page.close();
    console.log(`  ${id}.pdf  (${(pdf.length / 1024).toFixed(0)} KB)`);
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`Rendered ${ids.length} schedule PDF${ids.length === 1 ? '' : 's'}.`);

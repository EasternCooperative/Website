// Renders Of Play and Playfulness from a completed `dist/` build to
// public/docs/of-play-and-playfulness.pdf, printing the one-page print edition
// (/of-play-and-playfulness/print) with headless Chrome. The PDF gets
// bookmarks from the chapter and section headings, accessible tagging, and
// page numbers. Run in CI after `npm run build` (see the Rendered PDFs
// workflow); the workflow commits a changed PDF back to the repo.
//
//   node scripts/render-book-pdf.mjs
//
// Requires: a `dist/` directory, and `npx playwright install chromium`.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { PDFDocument, PDFDict, PDFHexString, PDFName } from 'pdf-lib';
import { serveDist } from './lib/serve-dist.mjs';

const DIST = 'dist';
const OUT = 'public/docs/of-play-and-playfulness.pdf';
const PORT = 4318;
const TITLE = 'Of Play and Playfulness';
const AUTHOR = 'Eastern Cooperative Recreation School';
const SOURCE_DATE = new Date(
  execFileSync(
    'git',
    ['log', '-1', '--format=%cI', '--', 'src/data/of-play-and-playfulness', 'src/pages/of-play-and-playfulness'],
    {
      encoding: 'utf8',
    }
  ).trim() || Date.now()
);

// Chrome sometimes names a bookmark twice over ("WINKWINK") when a heading is
// kept with the text after it across a page break. Walk the outline and put
// each doubled title back to one copy; also set the Author, which Chrome leaves
// blank.
async function finish(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.setTitle(TITLE);
  doc.setAuthor(AUTHOR);
  // Dated by the book's last change rather than the render, so re-rendering
  // unchanged text gives the same file and CI has nothing to commit.
  doc.setCreationDate(SOURCE_DATE);
  doc.setModificationDate(SOURCE_DATE);
  let fixed = 0;
  const visit = (ref) => {
    for (let item = ref && doc.context.lookup(ref, PDFDict); item;) {
      const title = item.lookup(PDFName.of('Title'));
      const text = title?.decodeText?.();
      if (text && text.length % 2 === 0 && text.slice(0, text.length / 2) === text.slice(text.length / 2)) {
        item.set(PDFName.of('Title'), PDFHexString.fromText(text.slice(0, text.length / 2)));
        fixed++;
      }
      visit(item.get(PDFName.of('First')));
      const next = item.get(PDFName.of('Next'));
      item = next && doc.context.lookup(next, PDFDict);
    }
  };
  const outlines = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  visit(outlines?.get(PDFName.of('First')));
  return { pdf: await doc.save(), fixed };
}

const server = await serveDist(DIST, PORT);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ colorScheme: 'light' });
  const response = await page.goto(`http://localhost:${PORT}/of-play-and-playfulness/print`, { waitUntil: 'load' });
  if (!response?.ok()) throw new Error(`The print edition did not load (HTTP ${response?.status()}).`);
  // Every image has to be loaded before Chrome lays out the pages. Lazy ones
  // below the fold never would be, so load them all now.
  await page.evaluate(async () => {
    for (const img of document.images) img.loading = 'eager';
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, (img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r))))
    );
  });
  // The PDF's Title comes from the document title, without the site suffix.
  await page.evaluate((title) => (document.title = title), TITLE);

  const footer = `
    <div style="width:100%;font-size:8pt;color:#666;padding:0 0.85in;display:flex;justify-content:space-between;font-family:Inter,system-ui,sans-serif">
      <span>${TITLE}</span><span class="pageNumber"></span>
    </div>`;
  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
    outline: true,
    tagged: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: footer,
  });
  const { pdf: finished, fixed } = await finish(pdf);
  await writeFile(OUT, finished);
  console.log(`  ${OUT}  (${(finished.length / (1024 * 1024)).toFixed(1)} MB, ${fixed} bookmark titles repaired)`);
} finally {
  await browser.close();
  server.close();
}

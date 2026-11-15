// A minimal static server over a completed `dist/` build, for the scripts that
// print built pages to PDF with headless Chrome (render-schedule-pdfs.mjs,
// render-book-pdf.mjs).

import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

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

/**
 * Serve `dist` on `port`. Resolves to { routes, close }.
 *
 * Walks dist/ once and maps every servable URL path to its on-disk file. The
 * request handler then only ever does `routes.get(...)`, so the path handed to
 * `readFile` originates from this filesystem walk, never from the request:
 * there is no request-controlled path expression to traverse out of dist/.
 */
export async function serveDist(dist, port) {
  if (!existsSync(dist)) {
    console.error(`No ${dist}/ directory. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const routes = new Map();
  async function indexDir(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await indexDir(abs);
        continue;
      }
      const url = '/' + relative(dist, abs).split(sep).join('/');
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
  await indexDir(dist);

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
  await new Promise((resolve) => server.listen(port, resolve));
  return { routes, close: () => server.close() };
}

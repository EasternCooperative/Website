#!/usr/bin/env node
// Local web page for reviewing the leadership history import, so the review
// files do not have to be edited by hand.
//
//   node scripts/review-leadership-history.mjs <export-dir>
//
// Run scripts/import-leadership-history.mjs once first so the review files exist.
// The page runs only on this computer (127.0.0.1) and needs the token in the link
// printed below. Press Ctrl+C to stop it.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createReviewServer } from './lib/review-server.mjs';

const dir = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!dir || !existsSync(path.join(dir, 'history-status.csv'))) {
  console.error('usage: review-leadership-history.mjs <export-dir>');
  console.error('The folder needs history-status.csv. Run scripts/import-leadership-history.mjs on it first.');
  process.exit(2);
}

const token = randomBytes(16).toString('hex');
const server = createReviewServer({ dir, token });
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(
    `Open this link in your browser (works only on this computer):\n\n  http://127.0.0.1:${port}/?t=${token}\n`
  );
  console.log('Changes save as you go. Press Ctrl+C when you are done.');
});

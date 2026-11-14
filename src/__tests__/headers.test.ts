import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Cloudflare Pages silently drops any _headers line longer than 2,000
// characters (indentation and header name included). The site then serves
// without that header and nothing errors, which is how the CSP went missing
// in production after #369 pushed it to 2,003 characters.
const LINE_LIMIT = 2000;
const lines = readFileSync('public/_headers', 'utf8').split('\n');

describe('public/_headers', () => {
  it.each(lines.map((line, i) => [i + 1, line] as const).filter(([, line]) => line.trim() && !line.startsWith('#')))(
    'line %i fits Cloudflare Pages’ 2,000-character limit',
    (_n, line) => {
      expect(line.length).toBeLessThanOrEqual(LINE_LIMIT);
    }
  );

  it('still sets a Content-Security-Policy for every page', () => {
    const i = lines.indexOf('/*');
    const block = lines.slice(
      i + 1,
      lines.findIndex((l, j) => j > i && !l.startsWith(' '))
    );
    expect(block.some((l) => l.trim().startsWith('Content-Security-Policy:'))).toBe(true);
  });
});

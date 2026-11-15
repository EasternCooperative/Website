import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatFileSize, publicFileSize } from './fileSize';

describe('formatFileSize', () => {
  it('shows kilobytes below a megabyte and megabytes from there up', () => {
    expect(formatFileSize(340 * 1024)).toBe('340 KB');
    expect(formatFileSize(2.44 * 1024 * 1024)).toBe('2.4 MB');
  });
});

describe('publicFileSize', () => {
  const root = mkdtempSync(join(tmpdir(), 'public-'));
  writeFileSync(join(root, 'a b.pdf'), Buffer.alloc(2048));

  it('reads the size of a file under the public root, decoding the URL', () => {
    expect(publicFileSize('/a%20b.pdf', root)).toBe('2 KB');
  });

  it('is undefined for an external URL or a missing file', () => {
    expect(publicFileSize('https://example.org/a.pdf', root)).toBeUndefined();
    expect(publicFileSize('/missing.pdf', root)).toBeUndefined();
  });
});

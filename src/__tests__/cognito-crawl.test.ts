import { describe, expect, it } from 'vitest';
import { crawlEntries } from '../../scripts/lib/cognito-crawl.mjs';

/** A form whose entries exist only at the given numbers. */
const form = (numbers: number[]) => async (p: string) => {
  const n = Number(p.split('/').pop());
  return numbers.includes(n) ? { Id: `f-${n}` } : null;
};

describe('crawling a form by entry number', () => {
  it('finds every entry and reports the highest number', async () => {
    const seen: string[] = [];
    const r = await crawlEntries(form([1, 2, 3, 5]), '9', { onEntry: (e: { Id: string }) => seen.push(e.Id) });
    expect(r).toEqual({ found: 4, highest: 5 });
    expect(seen.sort()).toEqual(['f-1', 'f-2', 'f-3', 'f-5']);
  });

  it('keeps going through a gap of 10 or more, which cut the old crawl short', async () => {
    const r = await crawlEntries(form([1, 2, 3, 45, 46]), '9'); // 41 missing numbers in between
    expect(r).toEqual({ found: 5, highest: 46 });
  });

  it('stops after a long run of misses, and handles an empty form', async () => {
    const calls: string[] = [];
    const r = await crawlEntries(async (p) => (calls.push(p), null), '9', { gap: 20, batch: 5 });
    expect(r).toEqual({ found: 0, highest: 0 });
    expect(calls).toHaveLength(20);
  });

  it('does not need a callback', async () => {
    expect(await crawlEntries(form([1]), '9', { gap: 10 })).toEqual({ found: 1, highest: 1 });
  });
});

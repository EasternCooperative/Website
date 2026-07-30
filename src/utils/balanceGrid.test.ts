import { describe, it, expect } from 'vitest';
import { balanceByWeight } from './balanceGrid';

describe('balanceByWeight', () => {
  it('sorts items by descending weight', () => {
    const items = ['short', 'a much longer piece of text', 'medium length'];
    const result = balanceByWeight(items, (item) => item.length);
    expect(result).toEqual(['a much longer piece of text', 'medium length', 'short']);
  });

  it('pairs adjacent items with similar weight for a two-column row', () => {
    const items = [{ w: 1 }, { w: 10 }, { w: 9 }, { w: 2 }];
    const result = balanceByWeight(items, (item) => item.w);
    // Sorted descending groups the two largest and the two smallest together,
    // which is what lands them in the same row of a 2-column grid.
    expect(result.map((i) => i.w)).toEqual([10, 9, 2, 1]);
  });

  it('keeps equal-weight items in their original relative order (stable sort)', () => {
    const items = [
      { name: 'a', w: 5 },
      { name: 'b', w: 5 },
      { name: 'c', w: 5 },
    ];
    const result = balanceByWeight(items, (item) => item.w);
    expect(result.map((i) => i.name)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const items = [1, 3, 2];
    const result = balanceByWeight(items, (n) => n);
    expect(items).toEqual([1, 3, 2]);
    expect(result).toEqual([3, 2, 1]);
  });

  it('handles an empty array', () => {
    expect(balanceByWeight([], (n: number) => n)).toEqual([]);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { updateRangeLabel, type RangeLabelPhrasing } from './rangeSlider';
import { RollingLabel } from './numberRoll';

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

// Generic phrasing used across these tests — mirrors the real call sites
// (Activities group-size filter, past-events year filter, Gallery year
// filter) closely enough to exercise the same four sentence shapes without
// tying this suite to any one consumer's wording.
const phrasing: RangeLabelPhrasing = {
  all: (l) => l.text('All'),
  minOnly: (l, min) => {
    l.text('Since ');
    l.reel('min', min);
  },
  maxOnly: (l, max) => {
    l.text('Through ');
    l.reel('max', max);
  },
  between: (l, min, max) => {
    l.reel('min', min);
    l.text('-');
    l.reel('max', max);
  },
};

describe('updateRangeLabel', () => {
  beforeEach(() => {
    mockReducedMotion(true); // makes setShape's rebuild fire on the next tick (fadeMs=0)
  });

  it('renders the "all" shape when neither handle has moved off its bound', async () => {
    const container = document.createElement('span');
    const label = new RollingLabel(container);

    updateRangeLabel(label, 1, 10, 1, 10, phrasing);
    await new Promise((r) => setTimeout(r, 0));

    expect(container.textContent).toBe('All');
  });

  it('renders the "minOnly" shape when only the min handle has moved', async () => {
    const container = document.createElement('span');
    const label = new RollingLabel(container);

    updateRangeLabel(label, 4, 10, 1, 10, phrasing);
    await new Promise((r) => setTimeout(r, 0));

    expect(container.textContent).toBe('Since 4');
  });

  it('renders the "maxOnly" shape when only the max handle has moved', async () => {
    const container = document.createElement('span');
    const label = new RollingLabel(container);

    updateRangeLabel(label, 1, 7, 1, 10, phrasing);
    await new Promise((r) => setTimeout(r, 0));

    expect(container.textContent).toBe('Through 7');
  });

  it('renders the "between" shape when both handles have moved', async () => {
    const container = document.createElement('span');
    const label = new RollingLabel(container);

    updateRangeLabel(label, 4, 7, 1, 10, phrasing);
    await new Promise((r) => setTimeout(r, 0));

    expect(container.textContent).toBe('4-7');
  });

  it('rolls the existing reels instead of rebuilding when the shape stays the same', async () => {
    const container = document.createElement('span');
    const label = new RollingLabel(container);

    updateRangeLabel(label, 4, 7, 1, 10, phrasing);
    await new Promise((r) => setTimeout(r, 0));

    updateRangeLabel(label, 5, 8, 1, 10, {
      ...phrasing,
      between: () => {
        throw new Error('build should not be called again for the same shape');
      },
    });

    expect(container.textContent).toBe('5-8');
  });
});

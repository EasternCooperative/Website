// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import RangeSlider from '~/components/ui/RangeSlider';
import type { RangeLabelPhrasing } from '~/utils/rangeSlider';
import { buttonWithText, cleanup, click, render, settle, textOf } from '../react';

const phrasing: RangeLabelPhrasing = {
  all: (l) => l.text('All years'),
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
    l.text(' to ');
    l.reel('max', max);
  },
};

beforeEach(() => {
  // The odometer label asks about reduced motion; say yes so it updates without animating.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(async () => {
  await cleanup();
  document.body.innerHTML = '';
});

async function slide(input: HTMLInputElement, value: number) {
  await act(async () => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mount(onChange = vi.fn()) {
  const { container } = await render(
    <RangeSlider
      rowLabel="Year"
      boundMin={2010}
      boundMax={2026}
      ariaLabelMin="Minimum year"
      ariaLabelMax="Maximum year"
      phrasing={phrasing}
      onChange={onChange}
    />
  );
  await settle();
  const min = container.querySelector<HTMLInputElement>('input[aria-label="Minimum year"]')!;
  const max = container.querySelector<HTMLInputElement>('input[aria-label="Maximum year"]')!;
  return { container, min, max, onChange };
}

describe('RangeSlider', () => {
  it('starts spanning the whole range, with no reset button', async () => {
    const { container, min, max } = await mount();

    expect([min.value, max.value]).toEqual(['2010', '2026']);
    expect(textOf(container)).toContain('Year');
    expect(textOf(container)).toContain('All years');
    expect(buttonWithText(container, 'Reset')).toBeNull();
  });

  it('reports a narrowed range and offers a reset', async () => {
    const { container, min, onChange } = await mount();

    await slide(min, 2018);

    expect(onChange).toHaveBeenLastCalledWith(2018, 2026);
    expect(buttonWithText(container, 'Reset')).not.toBeNull();
  });

  it('narrows from either end, and reset puts both back', async () => {
    const { container, min, max, onChange } = await mount();
    await slide(max, 2020);
    expect(onChange).toHaveBeenLastCalledWith(2010, 2020);
    await slide(min, 2014);
    expect(onChange).toHaveBeenLastCalledWith(2014, 2020);

    await click(buttonWithText(container, 'Reset'));

    expect(onChange).toHaveBeenLastCalledWith(2010, 2026);
    expect([min.value, max.value]).toEqual(['2010', '2026']);
    expect(buttonWithText(container, 'Reset')).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rollNumber, RollingLabel } from './numberRoll';

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

describe('rollNumber', () => {
  beforeEach(() => {
    mockReducedMotion(true); // avoids depending on real transition timing
  });

  it('sets the text content directly on first render', () => {
    const reel = document.createElement('span');
    rollNumber(reel, 6);
    expect(reel.textContent).toBe('6');
  });

  it('is a no-op re-render when the value is unchanged', () => {
    const reel = document.createElement('span');
    rollNumber(reel, 6);
    rollNumber(reel, 6);
    expect(reel.textContent).toBe('6');
    expect(reel.dataset.rollValue).toBe('6');
  });

  it('updates to the new value when the value changes, honoring reduced motion', () => {
    const reel = document.createElement('span');
    rollNumber(reel, 6);
    rollNumber(reel, 20);
    expect(reel.textContent).toBe('20');
    expect(reel.dataset.rollValue).toBe('20');
  });

  it('builds one digit wheel per character when motion is not reduced', () => {
    mockReducedMotion(false);
    const reel = document.createElement('span');
    rollNumber(reel, 6);
    rollNumber(reel, 20);
    const digits = reel.querySelectorAll(':scope > [data-digit]');
    expect(digits.length).toBe(2);
  });
});

describe('RollingLabel', () => {
  beforeEach(() => {
    mockReducedMotion(true); // makes setShape's rebuild fire on the next tick (fadeMs=0)
  });

  it('rebuilds the container the first time a shape is set', async () => {
    const container = document.createElement('span');
    const label = new RollingLabel(container);

    const changed = label.setShape('atLeast', (l) => {
      l.text('At least ');
      l.reel('min', 6);
      l.text(' people');
    });

    expect(changed).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('At least 6 people');
  });

  it('is a no-op when the shape key has not changed', async () => {
    const container = document.createElement('span');
    const label = new RollingLabel(container);
    label.setShape('atLeast', (l) => l.reel('min', 6));
    await new Promise((r) => setTimeout(r, 0));

    const changed = label.setShape('atLeast', () => {
      throw new Error('build should not be called again for the same shape');
    });

    expect(changed).toBe(false);
  });

  it('rolls an existing reel to a new value', async () => {
    const container = document.createElement('span');
    const label = new RollingLabel(container);
    label.setShape('atLeast', (l) => l.reel('min', 6));
    await new Promise((r) => setTimeout(r, 0));

    label.roll('min', 12);

    const reel = container.querySelector('[data-role="min"]');
    expect(reel?.textContent).toBe('12');
  });
});

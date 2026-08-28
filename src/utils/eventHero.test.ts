// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const stopScrollMock = vi.fn();
const scrollMock = vi.fn<(...args: unknown[]) => unknown>(() => stopScrollMock);

vi.mock('motion', () => ({
  scroll: (...args: unknown[]) => scrollMock(...args),
}));

function mockMatchMedia({ reducedMotion = false } = {}) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function mockHeight(px: number) {
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({ height: px }) as DOMRect);
}

function setScrollY(px: number) {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: px });
}

/** The callback initEventHero handed to motion's scroll(). */
function scrollCallback() {
  return scrollMock.mock.calls[0]?.[0] as () => void;
}

beforeEach(() => {
  // Flush any `astro:before-swap` listener left over from a previous test's
  // initEventHero() call (jsdom shares one `document` across tests).
  document.dispatchEvent(new Event('astro:before-swap'));
  document.body.innerHTML = '';
  document.documentElement.style.overflowAnchor = '';
  scrollMock.mockClear();
  stopScrollMock.mockClear();
  mockMatchMedia();
  mockHeight(400); // range clamps to MAX_RANGE_PX (320)
  setScrollY(0);
});

describe('initEventHero', () => {
  it('does nothing under prefers-reduced-motion', async () => {
    mockMatchMedia({ reducedMotion: true });
    document.body.innerHTML = '<div data-event-hero></div>';
    const { initEventHero } = await import('./eventHero');

    initEventHero();

    expect(scrollMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-event-hero]')?.hasAttribute('data-event-hero-ready')).toBe(false);
    expect(document.documentElement.style.overflowAnchor).toBe('');
  });

  it('does nothing when there is no hero on the page', async () => {
    document.body.innerHTML = '<div></div>';
    const { initEventHero } = await import('./eventHero');

    initEventHero();

    expect(scrollMock).not.toHaveBeenCalled();
  });

  it('bails without marking ready when the hero has no laid-out height', async () => {
    mockHeight(0);
    document.body.innerHTML = '<div data-event-hero></div>';
    const { initEventHero } = await import('./eventHero');

    initEventHero();

    expect(scrollMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-event-hero]')?.hasAttribute('data-event-hero-ready')).toBe(false);
  });

  it('wires up scroll(), marks the hero ready, and applies the initial open state', async () => {
    document.body.innerHTML = '<div data-event-hero><div data-event-hero-overlay></div></div>';
    const { initEventHero } = await import('./eventHero');

    initEventHero();

    const el = document.querySelector('[data-event-hero]') as HTMLElement;
    expect(el.dataset.eventHeroReady).toBe('true');
    expect(scrollMock).toHaveBeenCalledTimes(1);
    expect(el.style.maxHeight).toBe('400px'); // scrollY 0 -> fully open
    expect((el.querySelector('[data-event-hero-overlay]') as HTMLElement).style.opacity).toBe('1');
  });

  it('scrubs max-height and overlay opacity with scroll position over the range (min(openPx, 320))', async () => {
    document.body.innerHTML = '<div data-event-hero><div data-event-hero-overlay></div></div>';
    const { initEventHero } = await import('./eventHero');
    initEventHero();
    const el = document.querySelector('[data-event-hero]') as HTMLElement;
    const overlay = el.querySelector('[data-event-hero-overlay]') as HTMLElement;

    setScrollY(160); // half of 320
    scrollCallback()();
    expect(el.style.maxHeight).toBe('200px');
    expect(overlay.style.opacity).toBe('0.5');

    setScrollY(320); // end of range
    scrollCallback()();
    expect(el.style.maxHeight).toBe('0px');
    expect(overlay.style.opacity).toBe('0');

    setScrollY(5000); // past the range -> clamped
    scrollCallback()();
    expect(el.style.maxHeight).toBe('0px');
  });

  it('disables scroll anchoring only while within the collapse range', async () => {
    document.body.innerHTML = '<div data-event-hero></div>';
    const { initEventHero } = await import('./eventHero');
    initEventHero();

    // applied once at init, scrollY 0 -> within range
    expect(document.documentElement.style.overflowAnchor).toBe('none');

    setScrollY(1000); // past the range
    scrollCallback()();
    expect(document.documentElement.style.overflowAnchor).toBe('');

    setScrollY(50); // back near the top
    scrollCallback()();
    expect(document.documentElement.style.overflowAnchor).toBe('none');
  });

  it('tears down scroll + resize + the overflow-anchor override on astro:before-swap', async () => {
    document.body.innerHTML = '<div data-event-hero></div>';
    const { initEventHero } = await import('./eventHero');
    initEventHero();
    expect(document.documentElement.style.overflowAnchor).toBe('none');

    document.dispatchEvent(new Event('astro:before-swap'));

    expect(stopScrollMock).toHaveBeenCalledTimes(1);
    expect(document.documentElement.style.overflowAnchor).toBe('');
  });

  it('never re-processes a hero already marked ready', async () => {
    document.body.innerHTML = '<div data-event-hero data-event-hero-ready="true"></div>';
    const { initEventHero } = await import('./eventHero');

    initEventHero();

    expect(scrollMock).not.toHaveBeenCalled();
  });

  it('scopes to a given root', async () => {
    document.body.innerHTML =
      '<div id="a" data-event-hero></div><div id="scope"><div id="b" data-event-hero></div></div>';
    const { initEventHero } = await import('./eventHero');

    initEventHero(document.getElementById('scope')!);

    expect(document.getElementById('a')?.hasAttribute('data-event-hero-ready')).toBe(false);
    expect(document.getElementById('b')?.hasAttribute('data-event-hero-ready')).toBe(true);
  });
});

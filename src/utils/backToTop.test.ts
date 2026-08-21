// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// initBackToTopPage() registers a persistent astro:page-load listener on the
// shared jsdom `document`. Without removing them, listeners from earlier tests
// would keep firing and contaminate later tests.
let addedDocListeners: [string, EventListenerOrEventListenerObject][] = [];

beforeEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true, writable: true });
  // jsdom never runs layout, so scrollHeight defaults to 0 — tests that care about
  // visibility must opt into a "long" page explicitly via setPageHeight().
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    value: 3000,
    configurable: true,
    writable: true,
  });
  addedDocListeners = [];
  const originalAddEventListener = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    addedDocListeners.push([type, listener as EventListenerOrEventListenerObject]);
    return originalAddEventListener(type, listener, options);
  });
});

afterEach(() => {
  addedDocListeners.forEach(([type, listener]) => document.removeEventListener(type, listener));
  vi.restoreAllMocks();
});

function buildFixture() {
  document.body.innerHTML = `
    <button type="button" data-back-to-top class="opacity-0 pointer-events-none"></button>
  `;
}

function setPageHeight(scrollHeight: number) {
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    value: scrollHeight,
    configurable: true,
    writable: true,
  });
}

describe('initBackToTopPage — setup', () => {
  it('does nothing when there is no [data-back-to-top] button', async () => {
    const { initBackToTopPage } = await import('./backToTop');
    expect(() => initBackToTopPage()).not.toThrow();
  });

  it('does not double-wire the same button on a redundant astro:page-load', async () => {
    buildFixture();
    const { initBackToTopPage } = await import('./backToTop');
    initBackToTopPage();

    document.dispatchEvent(new Event('astro:page-load'));

    const button = document.querySelector<HTMLButtonElement>('[data-back-to-top]')!;
    expect(button.dataset.backToTopInitialized).toBe('true');

    const scrollTo = vi.fn();
    window.scrollTo = scrollTo;
    button.click();
    // If init had wired twice, this would fire twice.
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});

describe('initBackToTopPage — visibility', () => {
  it('starts hidden, and hides again once scrolled back above the threshold', async () => {
    buildFixture();
    const { initBackToTopPage } = await import('./backToTop');
    initBackToTopPage();

    const button = document.querySelector<HTMLButtonElement>('[data-back-to-top]')!;
    expect(button.classList.contains('opacity-0')).toBe(true);
    expect(button.classList.contains('pointer-events-none')).toBe(true);

    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true, writable: true });
    window.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('opacity-0')).toBe(false);
    expect(button.classList.contains('pointer-events-none')).toBe(false);

    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
    window.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('opacity-0')).toBe(true);
    expect(button.classList.contains('pointer-events-none')).toBe(true);
  });

  it('stays hidden at exactly the threshold (strictly greater-than)', async () => {
    buildFixture();
    const { initBackToTopPage } = await import('./backToTop');
    initBackToTopPage();

    const button = document.querySelector<HTMLButtonElement>('[data-back-to-top]')!;
    Object.defineProperty(window, 'scrollY', { value: 400, configurable: true, writable: true });
    window.dispatchEvent(new Event('scroll'));

    expect(button.classList.contains('opacity-0')).toBe(true);
  });
});

describe('initBackToTopPage — short pages', () => {
  it('never shows the button on a short page, even when scrolled', async () => {
    buildFixture();
    // 800px viewport, 1000px page — well under the 2.5x "long page" multiplier.
    setPageHeight(1000);
    const { initBackToTopPage } = await import('./backToTop');
    initBackToTopPage();

    const button = document.querySelector<HTMLButtonElement>('[data-back-to-top]')!;
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true, writable: true });
    window.dispatchEvent(new Event('scroll'));

    expect(button.classList.contains('opacity-0')).toBe(true);
  });

  it('re-evaluates page length on resize', async () => {
    buildFixture();
    setPageHeight(1000);
    const { initBackToTopPage } = await import('./backToTop');
    initBackToTopPage();

    const button = document.querySelector<HTMLButtonElement>('[data-back-to-top]')!;
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true, writable: true });
    window.dispatchEvent(new Event('scroll'));
    expect(button.classList.contains('opacity-0')).toBe(true);

    // Viewport shrinks (or content grows) enough to cross the long-page threshold.
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true, writable: true });
    window.dispatchEvent(new Event('resize'));
    expect(button.classList.contains('opacity-0')).toBe(false);
  });
});

describe('initBackToTopPage — click', () => {
  it('smooth-scrolls to top and clears any URL fragment', async () => {
    buildFixture();
    const { initBackToTopPage } = await import('./backToTop');
    initBackToTopPage();

    const scrollTo = vi.fn();
    window.scrollTo = scrollTo;
    const replaceState = vi.spyOn(history, 'replaceState');

    document.querySelector<HTMLButtonElement>('[data-back-to-top]')!.click();

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(replaceState).toHaveBeenCalledWith(null, '', window.location.pathname + window.location.search);
  });
});

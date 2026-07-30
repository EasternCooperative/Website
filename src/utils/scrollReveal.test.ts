// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const animateMock = vi.fn<(...args: unknown[]) => string>(() => 'animation-controls');
const scrollMock = vi.fn<(...args: unknown[]) => undefined>();

vi.mock('motion', () => ({
  animate: (...args: unknown[]) => animateMock(...args),
  scroll: (...args: unknown[]) => scrollMock(...args),
}));

function mockMatchMedia({ reducedMotion, desktop }: { reducedMotion: boolean; desktop: boolean }) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : desktop,
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

// Elements are "below the fold" (reveal window not yet reached) unless a test says
// otherwise — initScrollReveal reads getBoundingClientRect().top against innerHeight.
function mockBelowFold() {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({ top: 2000 }) as DOMRect);
}

function mockAlreadyEngaged() {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({ top: 0 }) as DOMRect);
}

beforeEach(() => {
  document.body.innerHTML = '';
  animateMock.mockClear();
  scrollMock.mockClear();
  mockMatchMedia({ reducedMotion: false, desktop: true });
  mockBelowFold();
});

describe('initScrollReveal', () => {
  it('does nothing under prefers-reduced-motion', async () => {
    mockMatchMedia({ reducedMotion: true, desktop: true });
    document.body.innerHTML = '<div data-scroll-reveal="up"></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    initScrollReveal();

    expect(scrollMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-scroll-reveal]')?.hasAttribute('data-scroll-reveal-ready')).toBe(false);
  });

  it('does nothing below the desktop breakpoint', async () => {
    mockMatchMedia({ reducedMotion: false, desktop: false });
    document.body.innerHTML = '<div data-scroll-reveal="up"></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    initScrollReveal();

    expect(scrollMock).not.toHaveBeenCalled();
  });

  it('wires up scroll + animate for an element below the fold', async () => {
    document.body.innerHTML = '<div data-scroll-reveal="up"></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    initScrollReveal();

    const el = document.querySelector('[data-scroll-reveal]') as HTMLElement;
    expect(el.dataset.scrollRevealReady).toBe('true');
    expect(animateMock).toHaveBeenCalledTimes(1);
    expect(scrollMock).toHaveBeenCalledTimes(1);
    expect(scrollMock).toHaveBeenCalledWith('animation-controls', {
      target: el,
      offset: ['start 95%', 'start 55%'],
    });
  });

  it('never re-processes an element already marked ready', async () => {
    document.body.innerHTML = '<div data-scroll-reveal="up" data-scroll-reveal-ready="true"></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    initScrollReveal();

    expect(scrollMock).not.toHaveBeenCalled();
  });

  it('skips [hidden] elements without marking them ready', async () => {
    document.body.innerHTML = '<div data-scroll-reveal="up" hidden></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    initScrollReveal();

    expect(scrollMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-scroll-reveal]')?.hasAttribute('data-scroll-reveal-ready')).toBe(false);
  });

  it('marks an already-engaged element ready but does not scroll-link it, leaving it fully visible', async () => {
    mockAlreadyEngaged();
    document.body.innerHTML = '<div data-scroll-reveal="up"></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    initScrollReveal();

    const el = document.querySelector('[data-scroll-reveal]') as HTMLElement;
    expect(el.dataset.scrollRevealReady).toBe('true');
    expect(animateMock).not.toHaveBeenCalled();
    expect(scrollMock).not.toHaveBeenCalled();
  });

  it('passes the correct translate offset per direction', async () => {
    document.body.innerHTML = `
      <div data-scroll-reveal="up"></div>
      <div data-scroll-reveal="left"></div>
      <div data-scroll-reveal="right"></div>
    `;
    const { initScrollReveal } = await import('./scrollReveal');

    initScrollReveal();

    expect(animateMock).toHaveBeenCalledTimes(3);
    const transforms = animateMock.mock.calls.map((call) => (call[1] as { transform: string[] }).transform[0]);
    expect(transforms).toEqual(['translate(0px, 64px)', 'translate(-80px, 0px)', 'translate(80px, 0px)']);
  });

  it('scopes to a given root without touching elements outside it', async () => {
    document.body.innerHTML =
      '<div id="a" data-scroll-reveal="up"></div><div id="scope"><div id="b" data-scroll-reveal="up"></div></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    initScrollReveal(document.getElementById('scope')!);

    expect(document.getElementById('a')?.hasAttribute('data-scroll-reveal-ready')).toBe(false);
    expect(document.getElementById('b')?.hasAttribute('data-scroll-reveal-ready')).toBe(true);
  });
});

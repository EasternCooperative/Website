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
// jsdom never runs layout, so the page height has to be stated: tall enough by default
// that every element can scroll all the way through its reveal window.
function setPageHeight(scrollHeight: number) {
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: scrollHeight });
}

function mockBelowFold() {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  setPageHeight(10000);
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

    await initScrollReveal();

    expect(scrollMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-scroll-reveal]')?.hasAttribute('data-scroll-reveal-ready')).toBe(false);
  });

  it('does nothing below the desktop breakpoint', async () => {
    mockMatchMedia({ reducedMotion: false, desktop: false });
    document.body.innerHTML = '<div data-scroll-reveal="up"></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    await initScrollReveal();

    expect(scrollMock).not.toHaveBeenCalled();
  });

  it('wires up scroll + animate for an element below the fold', async () => {
    document.body.innerHTML = '<div data-scroll-reveal="up"></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    await initScrollReveal();

    const el = document.querySelector('[data-scroll-reveal]') as HTMLElement;
    expect(el.dataset.scrollRevealReady).toBe('true');
    expect(animateMock).toHaveBeenCalledTimes(1);
    expect(scrollMock).toHaveBeenCalledTimes(1);
    expect(scrollMock).toHaveBeenCalledWith('animation-controls', {
      target: el,
      offset: ['start 85%', 'start 65%'],
    });
  });

  it('moves the reveal window down for an element that cannot scroll up to the default end line', async () => {
    // Viewport 900, page 2300: 1400px of scroll left. An element at 2000 stops rising
    // at 600px, which is 66.7% down the viewport and short of the 65% end line.
    setPageHeight(2300);
    document.body.innerHTML = '<div data-scroll-reveal="up"></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    await initScrollReveal();

    expect(scrollMock).toHaveBeenCalledWith('animation-controls', {
      target: document.querySelector('[data-scroll-reveal]'),
      offset: ['start 88%', 'start 68%'],
    });
  });

  it('never re-processes an element already marked ready', async () => {
    document.body.innerHTML = '<div data-scroll-reveal="up" data-scroll-reveal-ready="true"></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    await initScrollReveal();

    expect(scrollMock).not.toHaveBeenCalled();
  });

  it('skips [hidden] elements without marking them ready', async () => {
    document.body.innerHTML = '<div data-scroll-reveal="up" hidden></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    await initScrollReveal();

    expect(scrollMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-scroll-reveal]')?.hasAttribute('data-scroll-reveal-ready')).toBe(false);
  });

  it('marks an already-engaged element ready but does not scroll-link it, leaving it fully visible', async () => {
    mockAlreadyEngaged();
    document.body.innerHTML = '<div data-scroll-reveal="up"></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    await initScrollReveal();

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

    await initScrollReveal();

    expect(animateMock).toHaveBeenCalledTimes(3);
    const transforms = animateMock.mock.calls.map((call) => (call[1] as { transform: string[] }).transform[0]);
    expect(transforms).toEqual(['translate(0px, 64px)', 'translate(-80px, 0px)', 'translate(80px, 0px)']);
  });

  it('uses a shorter distance/duration and no blur for the "up-light" variant', async () => {
    document.body.innerHTML = '<div data-scroll-reveal="up-light"></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    await initScrollReveal();

    expect(animateMock).toHaveBeenCalledTimes(1);
    const [, keyframes, options] = animateMock.mock.calls[0] as [
      unknown,
      { transform: string[]; filter?: string[] },
      { duration: number },
    ];
    expect(keyframes.transform[0]).toBe('translate(0px, 16px)');
    expect(keyframes.filter).toBeUndefined();
    expect(options.duration).toBe(0.5);
  });

  it('falls back to the "up" offset for an unrecognized direction value', async () => {
    document.body.innerHTML = '<div data-scroll-reveal="sideways"></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    await initScrollReveal();

    expect(animateMock).toHaveBeenCalledTimes(1);
    const transform = (animateMock.mock.calls[0][1] as { transform: string[] }).transform[0];
    expect(transform).toBe('translate(0px, 64px)');
  });

  it('scopes to a given root without touching elements outside it', async () => {
    document.body.innerHTML =
      '<div id="a" data-scroll-reveal="up"></div><div id="scope"><div id="b" data-scroll-reveal="up"></div></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    await initScrollReveal(document.getElementById('scope')!);

    expect(document.getElementById('a')?.hasAttribute('data-scroll-reveal-ready')).toBe(false);
    expect(document.getElementById('b')?.hasAttribute('data-scroll-reveal-ready')).toBe(true);
  });
});

describe('revealWindow', () => {
  it('keeps the default window when the element can reach the end line', async () => {
    const { revealWindow } = await import('./scrollReveal');

    expect(revealWindow(-200)).toEqual([85, 65]);
    expect(revealWindow(65)).toEqual([85, 65]);
  });

  it('ends just before the scroll limit and keeps the 20-point span while it fits', async () => {
    const { revealWindow } = await import('./scrollReveal');

    expect(revealWindow(70.2)).toEqual([92, 72]);
  });

  it('squeezes the window against the bottom edge for an element that barely enters the viewport', async () => {
    const { revealWindow } = await import('./scrollReveal');

    expect(revealWindow(90)).toEqual([100, 91]);
    expect(revealWindow(99.5)).toEqual([100, 99]);
  });
});

describe('initScrollReveal when the animation chunk cannot load', () => {
  it('shows the content again instead of leaving it hidden', async () => {
    vi.resetModules();
    vi.doMock('./scrollRevealMotion', () => {
      throw new Error('chunk failed to load');
    });
    document.body.innerHTML = '<div data-scroll-reveal="up"></div>';
    const { initScrollReveal } = await import('./scrollReveal');

    await initScrollReveal();

    const el = document.querySelector<HTMLElement>('[data-scroll-reveal]')!;
    expect(el.style.opacity).toBe('');
    vi.doUnmock('./scrollRevealMotion');
  });
});

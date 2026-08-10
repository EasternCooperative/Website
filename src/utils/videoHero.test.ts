// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// initVideoHeroPage() registers a persistent 'astro:page-load' listener on the shared
// jsdom `document`. Without removing it, listeners from earlier tests would keep firing
// (each closing over its own now-stale module instance) and contaminate later tests.
let addedDocListeners: [string, EventListenerOrEventListenerObject][] = [];

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  mockReducedMotion(false);
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  addedDocListeners = [];
  const originalAddEventListener = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    addedDocListeners.push([type, listener as EventListenerOrEventListenerObject]);
    return originalAddEventListener(type, listener, options);
  });
});

afterEach(() => {
  addedDocListeners.forEach(([type, listener]) => document.removeEventListener(type, listener));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function loadAndTrigger() {
  const { initVideoHeroPage } = await import('./videoHero');
  initVideoHeroPage();
  document.dispatchEvent(new Event('astro:page-load'));
  // Let any play() promise microtasks settle.
  await vi.advanceTimersByTimeAsync(0);
}

describe('initVideoHero — header offset', () => {
  function buildHeaderFixture(headerHeight: number) {
    document.body.innerHTML = `
      <header id="header"></header>
      <section data-video-hero>
        <div data-video-hero-content></div>
      </section>
    `;
    const header = document.getElementById('header')!;
    header.getBoundingClientRect = vi.fn(() => ({ height: headerHeight }) as DOMRect);
  }

  it('offsets the section and content padding by the header height', async () => {
    buildHeaderFixture(80);
    await loadAndTrigger();

    const section = document.querySelector('[data-video-hero]') as HTMLElement;
    const content = document.querySelector('[data-video-hero-content]') as HTMLElement;

    expect(section.style.marginTop).toBe('-80px');
    expect(content.style.paddingTop).toBe('112px');
  });

  it('does nothing when there is no [data-video-hero] section', async () => {
    document.body.innerHTML = `<header id="header"></header>`;
    await expect(loadAndTrigger()).resolves.not.toThrow();
  });

  it('recalculates the offset on window resize', async () => {
    buildHeaderFixture(80);
    await loadAndTrigger();

    const header = document.getElementById('header')!;
    header.getBoundingClientRect = vi.fn(() => ({ height: 120 }) as DOMRect);
    window.dispatchEvent(new Event('resize'));

    const section = document.querySelector('[data-video-hero]') as HTMLElement;
    expect(section.style.marginTop).toBe('-120px');
  });

  it('stops recalculating after astro:before-preparation aborts the resize listener', async () => {
    buildHeaderFixture(80);
    await loadAndTrigger();

    document.dispatchEvent(new Event('astro:before-preparation'));

    const header = document.getElementById('header')!;
    header.getBoundingClientRect = vi.fn(() => ({ height: 999 }) as DOMRect);
    window.dispatchEvent(new Event('resize'));

    const section = document.querySelector('[data-video-hero]') as HTMLElement;
    expect(section.style.marginTop).toBe('-80px');
  });
});

describe('initVideoHero — playback toggle', () => {
  function buildToggleFixture() {
    document.body.innerHTML = `
      <section data-video-hero>
        <video data-hero-video></video>
        <button data-video-toggle aria-label="Pause background video">
          <svg data-icon-pause></svg>
          <svg data-icon-play class="hidden"></svg>
          <span data-video-toggle-label class="hidden">Play video</span>
        </button>
      </section>
    `;
  }

  it('autoplays the single video and shows the pause icon', async () => {
    buildToggleFixture();
    await loadAndTrigger();

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    const toggle = document.querySelector('[data-video-toggle]')!;
    expect(toggle.getAttribute('aria-label')).toBe('Pause background video');
  });

  it('pauses on toggle click and updates aria-label/icons', async () => {
    buildToggleFixture();
    await loadAndTrigger();

    const toggle = document.querySelector<HTMLButtonElement>('[data-video-toggle]')!;
    toggle.click();

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(toggle.getAttribute('aria-label')).toBe('Play background video');
    expect(document.querySelector('[data-icon-pause]')!.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('[data-icon-play]')!.classList.contains('hidden')).toBe(false);
  });

  it('resumes on a second toggle click', async () => {
    buildToggleFixture();
    await loadAndTrigger();

    const toggle = document.querySelector<HTMLButtonElement>('[data-video-toggle]')!;
    toggle.click();
    toggle.click();

    expect(toggle.getAttribute('aria-label')).toBe('Pause background video');
  });

  it('corrects the icon to "play" when autoplay is blocked by the browser', async () => {
    buildToggleFixture();
    HTMLMediaElement.prototype.play = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    await loadAndTrigger();

    expect(document.querySelector('[data-icon-play]')!.classList.contains('hidden')).toBe(false);
    expect(document.querySelector('[data-icon-pause]')!.classList.contains('hidden')).toBe(true);
  });

  it('flags the toggle for attention and reveals its label when autoplay is blocked', async () => {
    buildToggleFixture();
    HTMLMediaElement.prototype.play = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    await loadAndTrigger();

    const toggle = document.querySelector('[data-video-toggle]')!;
    expect(toggle.getAttribute('data-attention')).toBe('true');
    expect(document.querySelector('[data-video-toggle-label]')!.classList.contains('hidden')).toBe(false);
  });

  it('does not flag the toggle for attention when autoplay succeeds', async () => {
    buildToggleFixture();
    await loadAndTrigger();

    const toggle = document.querySelector('[data-video-toggle]')!;
    expect(toggle.getAttribute('data-attention')).toBeNull();
    expect(document.querySelector('[data-video-toggle-label]')!.classList.contains('hidden')).toBe(true);
  });

  it('clears the attention flag once the visitor manually clicks the toggle', async () => {
    buildToggleFixture();
    HTMLMediaElement.prototype.play = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    await loadAndTrigger();

    const toggle = document.querySelector<HTMLButtonElement>('[data-video-toggle]')!;
    expect(toggle.getAttribute('data-attention')).toBe('true');

    toggle.click();

    expect(toggle.getAttribute('data-attention')).toBeNull();
    expect(document.querySelector('[data-video-toggle-label]')!.classList.contains('hidden')).toBe(true);
  });

  it('flags the toggle for attention when autoplay is blocked in the multi-video crossfade branch', async () => {
    document.body.innerHTML = `
      <section data-video-hero>
        <video data-hero-video></video>
        <video data-hero-video></video>
        <button data-video-toggle aria-label="Pause background video">
          <svg data-icon-pause></svg>
          <svg data-icon-play class="hidden"></svg>
          <span data-video-toggle-label class="hidden">Play video</span>
        </button>
      </section>
    `;
    HTMLMediaElement.prototype.play = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    await loadAndTrigger();

    const toggle = document.querySelector('[data-video-toggle]')!;
    expect(toggle.getAttribute('data-attention')).toBe('true');
    expect(document.querySelector('[data-video-toggle-label]')!.classList.contains('hidden')).toBe(false);
  });
});

describe('initVideoHero — reduced motion', () => {
  it('pauses the video and hides the toggle button', async () => {
    document.body.innerHTML = `
      <section data-video-hero>
        <video data-hero-video></video>
        <button data-video-toggle></button>
      </section>
    `;
    mockReducedMotion(true);
    await loadAndTrigger();

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    const toggle = document.querySelector<HTMLButtonElement>('[data-video-toggle]')!;
    expect(toggle.style.display).toBe('none');
  });
});

describe('initVideoHero — multi-video crossfade', () => {
  function buildCrossfadeFixture() {
    document.body.innerHTML = `
      <section data-video-hero>
        <video data-hero-video></video>
        <video data-hero-video></video>
      </section>
    `;
  }

  it('crossfades to the next video when the current one ends', async () => {
    buildCrossfadeFixture();
    await loadAndTrigger();

    const videos = document.querySelectorAll<HTMLVideoElement>('[data-hero-video]');
    videos[0].dispatchEvent(new Event('ended'));

    expect(videos[1].style.opacity).toBe('1');
    expect(videos[0].style.opacity).toBe('0');

    await vi.advanceTimersByTimeAsync(2100);

    // After the crossfade transition completes the outgoing clip is reset and paused.
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it('queues a second requested transition until the in-flight one finishes', async () => {
    buildCrossfadeFixture();
    await loadAndTrigger();

    const videos = document.querySelectorAll<HTMLVideoElement>('[data-hero-video]');
    videos[0].dispatchEvent(new Event('ended'));
    // A second "ended" while still transitioning queues rather than re-entering.
    videos[0].dispatchEvent(new Event('ended'));

    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(2100);

    expect(videos[1].style.opacity).toBe('1');
  });
});

describe('initVideoHero — auto-stop after repeated cycles', () => {
  it('auto-pauses a single video after two full ended-cycles', async () => {
    document.body.innerHTML = `
      <section data-video-hero>
        <video data-hero-video></video>
        <button data-video-toggle></button>
      </section>
    `;
    await loadAndTrigger();

    const video = document.querySelector<HTMLVideoElement>('[data-hero-video]')!;
    const pauseSpy = HTMLMediaElement.prototype.pause as unknown as ReturnType<typeof vi.fn>;
    pauseSpy.mockClear();

    video.dispatchEvent(new Event('ended')); // cycle 1 — replays
    video.dispatchEvent(new Event('ended')); // cycle 2 — hits MAX_CYCLES, auto-stops

    const toggle = document.querySelector('[data-video-toggle]')!;
    expect(toggle.getAttribute('aria-label')).toBe('Play background video');
    expect(video.currentTime).toBe(0);
  });

  it('ignores an ended event fired while playback is already paused', async () => {
    document.body.innerHTML = `
      <section data-video-hero>
        <video data-hero-video></video>
        <button data-video-toggle></button>
      </section>
    `;
    await loadAndTrigger();

    const toggle = document.querySelector<HTMLButtonElement>('[data-video-toggle]')!;
    toggle.click(); // user pauses manually
    const playSpy = HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
    playSpy.mockClear();

    document.querySelector<HTMLVideoElement>('[data-hero-video]')!.dispatchEvent(new Event('ended'));

    expect(playSpy).not.toHaveBeenCalled();
  });
});

describe('initCountdown', () => {
  function buildCountdownFixture(iso: string) {
    document.body.innerHTML = `<div data-countdown="${iso}"></div>`;
  }

  it('does nothing when there is no [data-countdown] element', async () => {
    document.body.innerHTML = '';
    await expect(loadAndTrigger()).resolves.not.toThrow();
  });

  it('renders hrs/min/sec, zero-padded, for a sub-day countdown', async () => {
    buildCountdownFixture(new Date(Date.now() + 3 * 3_600_000 + 5 * 60_000 + 9_000).toISOString());
    await loadAndTrigger();

    const el = document.querySelector('[data-countdown]')!;
    const values = Array.from(el.querySelectorAll('span')).map((s) => s.textContent);
    expect(values).toEqual(['03', 'hrs', '05', 'min', '09', 'sec']);
  });

  it('renders day/hrs for a multi-day countdown', async () => {
    buildCountdownFixture(new Date(Date.now() + 2 * 86_400_000 + 3 * 3_600_000).toISOString());
    await loadAndTrigger();

    const el = document.querySelector('[data-countdown]')!;
    const values = Array.from(el.querySelectorAll('span')).map((s) => s.textContent);
    expect(values).toEqual(['2', 'days', '3', 'hrs']);
  });

  it('renders month/days for a multi-month countdown', async () => {
    buildCountdownFixture(new Date(Date.now() + 40 * 86_400_000).toISOString());
    await loadAndTrigger();

    const el = document.querySelector('[data-countdown]')!;
    const values = Array.from(el.querySelectorAll('span')).map((s) => s.textContent);
    expect(values).toEqual(['1', 'month', '10', 'days']);
  });

  it('renders year/mo for a multi-year countdown', async () => {
    buildCountdownFixture(new Date(Date.now() + 400 * 86_400_000).toISOString());
    await loadAndTrigger();

    const el = document.querySelector('[data-countdown]')!;
    const values = Array.from(el.querySelectorAll('span')).map((s) => s.textContent);
    expect(values).toEqual(['1', 'year', '1', 'mo']);
  });

  it('updates the ticking values on each interval without changing the label set', async () => {
    buildCountdownFixture(new Date(Date.now() + 10_000).toISOString());
    await loadAndTrigger();

    const el = document.querySelector('[data-countdown]')!;
    const before = Array.from(el.querySelectorAll('span')).map((s) => s.textContent);

    await vi.advanceTimersByTimeAsync(1000);

    const after = Array.from(el.querySelectorAll('span')).map((s) => s.textContent);
    const labels = (list: (string | null)[]) => list.filter((_, i) => i % 2 === 1);
    expect(labels(after)).toEqual(labels(before));
    expect(after).not.toEqual(before);
    expect(after[5]).toBe('sec');
  });

  it('hides the element and stops ticking once the target time passes', async () => {
    buildCountdownFixture(new Date(Date.now() + 1500).toISOString());
    await loadAndTrigger();

    const el = document.querySelector<HTMLElement>('[data-countdown]')!;
    await vi.advanceTimersByTimeAsync(2000);

    expect(el.hidden).toBe(true);
  });

  it('stops ticking after astro:before-preparation clears the interval', async () => {
    buildCountdownFixture(new Date(Date.now() + 60_000).toISOString());
    await loadAndTrigger();

    document.dispatchEvent(new Event('astro:before-preparation'));

    const el = document.querySelector('[data-countdown]')!;
    const before = el.innerHTML;
    await vi.advanceTimersByTimeAsync(5000);

    expect(el.innerHTML).toBe(before);
  });
});

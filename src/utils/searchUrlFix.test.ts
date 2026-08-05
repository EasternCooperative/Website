// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// initPagefindFixes() registers a persistent 'astro:after-swap' listener on the shared
// jsdom `document`. Without removing it, listeners from earlier tests in this file would
// keep firing (each closing over its own now-stale module instance) and contaminate later
// tests' assertions — so track and strip every listener this suite adds, each test.
let addedListeners: [string, EventListenerOrEventListenerObject][] = [];

beforeEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
  addedListeners = [];
  const originalAddEventListener = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    addedListeners.push([type, listener as EventListenerOrEventListenerObject]);
    return originalAddEventListener(type, listener, options);
  });
});

afterEach(() => {
  addedListeners.forEach(([type, listener]) => document.removeEventListener(type, listener));
  vi.restoreAllMocks();
});

describe('initPagefindFixes — href normalization', () => {
  it('strips a trailing slash from a same-path pagefind result href', async () => {
    document.body.innerHTML = `<pagefind-modal><a href="/our-people/">Our People</a></pagefind-modal>`;
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();

    expect(document.querySelector('a')?.getAttribute('href')).toBe('/our-people');
  });

  it('preserves query and hash when stripping the trailing slash', async () => {
    document.body.innerHTML = `
      <pagefind-modal>
        <a id="q" href="/our-people/?x=1">Q</a>
        <a id="h" href="/our-people/#team">H</a>
      </pagefind-modal>
    `;
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();

    expect(document.getElementById('q')?.getAttribute('href')).toBe('/our-people?x=1');
    expect(document.getElementById('h')?.getAttribute('href')).toBe('/our-people#team');
  });

  it('leaves the root path "/" untouched', async () => {
    document.body.innerHTML = `<pagefind-modal><a href="/">Home</a></pagefind-modal>`;
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();

    expect(document.querySelector('a')?.getAttribute('href')).toBe('/');
  });

  it('leaves an already slash-less href untouched', async () => {
    document.body.innerHTML = `<pagefind-modal><a href="/our-people">Our People</a></pagefind-modal>`;
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();

    expect(document.querySelector('a')?.getAttribute('href')).toBe('/our-people');
  });

  it('leaves an external/absolute href untouched', async () => {
    document.body.innerHTML = `<pagefind-modal><a href="https://example.com/foo/">External</a></pagefind-modal>`;
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();

    expect(document.querySelector('a')?.getAttribute('href')).toBe('https://example.com/foo/');
  });

  it('also fixes hrefs inside pagefind-results containers', async () => {
    document.body.innerHTML = `<pagefind-results><a href="/events/">Events</a></pagefind-results>`;
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();

    expect(document.querySelector('a')?.getAttribute('href')).toBe('/events');
  });

  it('ignores anchors outside pagefind containers', async () => {
    document.body.innerHTML = `<a href="/outside/">Outside</a>`;
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();

    expect(document.querySelector('a')?.getAttribute('href')).toBe('/outside/');
  });

  it('normalizes hrefs on anchors added later via MutationObserver', async () => {
    document.body.innerHTML = `<pagefind-modal></pagefind-modal>`;
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();

    const modal = document.querySelector('pagefind-modal')!;
    const a = document.createElement('a');
    a.setAttribute('href', '/new-result/');
    modal.appendChild(a);

    await flushMicrotasks();

    expect(a.getAttribute('href')).toBe('/new-result');
  });
});

describe('initPagefindFixes — modal close on result click', () => {
  it('closes the modal when a result link is clicked', async () => {
    document.body.innerHTML = `<pagefind-modal><a href="/foo">Foo</a></pagefind-modal>`;
    const modal = document.querySelector('pagefind-modal') as HTMLElement & { close?: () => void };
    modal.close = vi.fn();
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(modal.close).toHaveBeenCalledTimes(1);
  });

  it('does not close the modal when clicking non-link content', async () => {
    document.body.innerHTML = `<pagefind-modal><span>Not a link</span></pagefind-modal>`;
    const modal = document.querySelector('pagefind-modal') as HTMLElement & { close?: () => void };
    modal.close = vi.fn();
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();
    document.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(modal.close).not.toHaveBeenCalled();
  });

  it('only wires the close listener once per modal', async () => {
    document.body.innerHTML = `<pagefind-modal><a href="/foo">Foo</a></pagefind-modal>`;
    const modal = document.querySelector('pagefind-modal') as HTMLElement & { close?: () => void };
    modal.close = vi.fn();
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();
    // Re-dispatch astro:after-swap to trigger a second init pass without a real navigation.
    document.dispatchEvent(new Event('astro:after-swap'));
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(modal.close).toHaveBeenCalledTimes(1);
  });
});

describe('initPagefindFixes — astro:after-swap', () => {
  it('purges disconnected components from the pagefind instance registry', async () => {
    document.body.innerHTML = `<pagefind-modal></pagefind-modal>`;
    const modal = document.querySelector('pagefind-modal') as HTMLElement & { instance?: unknown };

    const connected = document.createElement('div');
    document.body.appendChild(connected);
    const disconnected = document.createElement('div');

    modal.instance = {
      components: [connected, disconnected],
      componentsByType: { trigger: [connected, disconnected] },
    };

    const { initPagefindFixes } = await import('./searchUrlFix');
    initPagefindFixes();

    document.dispatchEvent(new Event('astro:after-swap'));

    const inst = modal.instance as { components: unknown[]; componentsByType: Record<string, unknown[]> };
    expect(inst.components).toEqual([connected]);
    expect(inst.componentsByType.trigger).toEqual([connected]);
  });

  it('does nothing when there is no modal instance yet', async () => {
    document.body.innerHTML = `<pagefind-modal></pagefind-modal>`;
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();

    expect(() => document.dispatchEvent(new Event('astro:after-swap'))).not.toThrow();
  });

  it('normalizes hrefs in a freshly-swapped-in container (new element reference)', async () => {
    document.body.innerHTML = `<pagefind-modal><a href="/foo/">Foo</a></pagefind-modal>`;
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();
    expect(document.querySelector('a')?.getAttribute('href')).toBe('/foo');

    // A real Astro View Transitions swap replaces the container with a new element,
    // which is a fresh key in the module's WeakMap and so gets (re-)processed.
    document.body.innerHTML = `<pagefind-modal><a href="/bar/">Bar</a></pagefind-modal>`;
    document.dispatchEvent(new Event('astro:after-swap'));

    expect(document.querySelector('a')?.getAttribute('href')).toBe('/bar');
    await flushMicrotasks();
  });

  it('does not re-scan an unchanged container on a redundant swap event', async () => {
    document.body.innerHTML = `<pagefind-modal><a href="/foo/">Foo</a></pagefind-modal>`;
    const { initPagefindFixes } = await import('./searchUrlFix');

    initPagefindFixes();
    expect(document.querySelector('a')?.getAttribute('href')).toBe('/foo');

    // The same container reference is already tracked, so a direct attribute mutation
    // (not a childList change) isn't picked up by the MutationObserver or re-scanned.
    document.querySelector('a')!.setAttribute('href', '/bar/');
    document.dispatchEvent(new Event('astro:after-swap'));

    expect(document.querySelector('a')?.getAttribute('href')).toBe('/bar/');
  });
});

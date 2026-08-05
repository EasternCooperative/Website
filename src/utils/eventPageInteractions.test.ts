// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// initEventPageInteractions() registers persistent listeners on the shared jsdom
// `document` (astro:page-load, click-delegation for maps fallback). Without removing
// them, listeners from earlier tests would keep firing and contaminate later tests.
let addedListeners: [string, EventListenerOrEventListenerObject][] = [];

beforeEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
  vi.useFakeTimers();
  addedListeners = [];
  const originalAddEventListener = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    addedListeners.push([type, listener as EventListenerOrEventListenerObject]);
    return originalAddEventListener(type, listener, options);
  });
});

afterEach(() => {
  addedListeners.forEach(([type, listener]) => document.removeEventListener(type, listener));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makePopover(id: string) {
  const pop = document.createElement('div');
  pop.id = id;
  pop.setAttribute('popover', '');
  const card = document.createElement('div');
  card.textContent = 'content';
  pop.appendChild(card);

  let open = false;
  pop.showPopover = vi.fn(() => {
    open = true;
  });
  pop.hidePopover = vi.fn(() => {
    open = false;
  });
  const originalMatches = pop.matches.bind(pop);
  pop.matches = vi.fn((selector: string) =>
    selector === ':popover-open' ? open : originalMatches(selector)
  ) as unknown as typeof pop.matches;

  return pop;
}

describe('initEventPageInteractions — leader popovers', () => {
  it('shows the popover and marks aria-expanded on mouseenter', async () => {
    const btn = document.createElement('button');
    btn.dataset.popoverTarget = 'pop-1';
    const pop = makePopover('pop-1');
    document.body.append(btn, pop);

    const { initEventPageInteractions } = await import('./eventPageInteractions');
    initEventPageInteractions();

    btn.dispatchEvent(new MouseEvent('mouseenter'));

    expect(pop.showPopover).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(pop.style.position).toBe('fixed');
  });

  it('hides the popover after a delay on mouseleave', async () => {
    const btn = document.createElement('button');
    btn.dataset.popoverTarget = 'pop-1';
    const pop = makePopover('pop-1');
    document.body.append(btn, pop);

    const { initEventPageInteractions } = await import('./eventPageInteractions');
    initEventPageInteractions();

    btn.dispatchEvent(new MouseEvent('mouseenter'));
    btn.dispatchEvent(new MouseEvent('mouseleave'));

    expect(pop.hidePopover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(pop.hidePopover).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('cancels the pending hide when the pointer moves onto the popover itself', async () => {
    const btn = document.createElement('button');
    btn.dataset.popoverTarget = 'pop-1';
    const pop = makePopover('pop-1');
    document.body.append(btn, pop);

    const { initEventPageInteractions } = await import('./eventPageInteractions');
    initEventPageInteractions();

    btn.dispatchEvent(new MouseEvent('mouseenter'));
    btn.dispatchEvent(new MouseEvent('mouseleave'));
    pop.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(120);

    expect(pop.hidePopover).not.toHaveBeenCalled();
  });

  it('hides the popover after leaving it too', async () => {
    const btn = document.createElement('button');
    btn.dataset.popoverTarget = 'pop-1';
    const pop = makePopover('pop-1');
    document.body.append(btn, pop);

    const { initEventPageInteractions } = await import('./eventPageInteractions');
    initEventPageInteractions();

    btn.dispatchEvent(new MouseEvent('mouseenter'));
    pop.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(120);

    expect(pop.hidePopover).toHaveBeenCalledTimes(1);
  });

  it('click always shows the popover', async () => {
    const btn = document.createElement('button');
    btn.dataset.popoverTarget = 'pop-1';
    const pop = makePopover('pop-1');
    document.body.append(btn, pop);

    const { initEventPageInteractions } = await import('./eventPageInteractions');
    initEventPageInteractions();

    btn.dispatchEvent(new MouseEvent('click'));

    expect(pop.showPopover).toHaveBeenCalledTimes(1);
  });

  it('does not call showPopover again if already open', async () => {
    const btn = document.createElement('button');
    btn.dataset.popoverTarget = 'pop-1';
    const pop = makePopover('pop-1');
    document.body.append(btn, pop);

    const { initEventPageInteractions } = await import('./eventPageInteractions');
    initEventPageInteractions();

    btn.dispatchEvent(new MouseEvent('mouseenter'));
    btn.dispatchEvent(new MouseEvent('click'));

    expect(pop.showPopover).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a trigger whose target id does not exist', async () => {
    const btn = document.createElement('button');
    btn.dataset.popoverTarget = 'missing';
    document.body.append(btn);

    const { initEventPageInteractions } = await import('./eventPageInteractions');
    expect(() => initEventPageInteractions()).not.toThrow();
    expect(() => btn.dispatchEvent(new MouseEvent('mouseenter'))).not.toThrow();
  });

  it('re-wires newly-added popovers on astro:page-load', async () => {
    const { initEventPageInteractions } = await import('./eventPageInteractions');
    initEventPageInteractions();

    const btn = document.createElement('button');
    btn.dataset.popoverTarget = 'pop-2';
    const pop = makePopover('pop-2');
    document.body.append(btn, pop);

    document.dispatchEvent(new Event('astro:page-load'));
    btn.dispatchEvent(new MouseEvent('mouseenter'));

    expect(pop.showPopover).toHaveBeenCalledTimes(1);
  });
});

describe('initEventPageInteractions — share button', () => {
  function makeShareButton() {
    const btn = document.createElement('button');
    btn.id = 'share-btn';
    btn.dataset.title = 'Event Title';
    btn.dataset.text = 'Come join us';
    btn.innerHTML = '<span>Share</span>';
    document.body.append(btn);
    return btn;
  }

  it('does nothing when there is no share button', async () => {
    const { initEventPageInteractions } = await import('./eventPageInteractions');
    expect(() => initEventPageInteractions()).not.toThrow();
  });

  it('uses navigator.share when available', async () => {
    const btn = makeShareButton();
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: shareMock, configurable: true });

    const { initEventPageInteractions } = await import('./eventPageInteractions');
    initEventPageInteractions();
    btn.dispatchEvent(new MouseEvent('click'));
    await vi.waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));

    expect(shareMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Event Title', text: 'Come join us', url: window.location.href })
    );

    // @ts-expect-error cleaning up a test-only stub
    delete navigator.share;
  });

  it('falls back to clipboard copy with a "Copied!" confirmation when share is unavailable', async () => {
    const btn = makeShareButton();
    const originalHTML = btn.innerHTML;
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: writeTextMock }, configurable: true });

    const { initEventPageInteractions } = await import('./eventPageInteractions');
    initEventPageInteractions();
    btn.dispatchEvent(new MouseEvent('click'));
    await vi.waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));

    expect(writeTextMock).toHaveBeenCalledWith(window.location.href);
    expect(btn.innerHTML).toContain('Copied!');

    vi.advanceTimersByTime(2000);
    expect(btn.innerHTML).toBe(originalHTML);
  });
});

describe('initEventPageInteractions — maps fallback', () => {
  function makeMapsLink() {
    const a = document.createElement('a');
    a.href = 'geo:0,0?q=123+Main+St';
    a.dataset.mapsFallback = 'https://maps.apple.com/?q=123+Main+St';
    a.textContent = 'Directions';
    document.body.append(a);
    return a;
  }

  it('opens the fallback URL and prevents default navigation on desktop', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15',
      configurable: true,
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const a = makeMapsLink();

    const { initEventPageInteractions } = await import('./eventPageInteractions');
    initEventPageInteractions();

    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('https://maps.apple.com/?q=123+Main+St', '_blank', 'noopener,noreferrer');
  });

  it('lets the native geo: link proceed on a mobile user agent', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const a = makeMapsLink();

    const { initEventPageInteractions } = await import('./eventPageInteractions');
    initEventPageInteractions();

    const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('ignores clicks that are not on a maps-fallback link', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0', configurable: true });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const other = document.createElement('button');
    other.textContent = 'Not a maps link';
    document.body.append(other);

    const { initEventPageInteractions } = await import('./eventPageInteractions');
    initEventPageInteractions();

    other.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(openSpy).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// initPastEventsFiltersPage() registers a persistent astro:page-load listener on the
// shared jsdom `document`. Without removing them, listeners from earlier tests would
// keep firing and contaminate later tests.
let addedDocListeners: [string, EventListenerOrEventListenerObject][] = [];

// apply() calls scrollReveal's initScrollReveal() after touching the DOM. Reporting
// "not desktop" here makes it a no-op (see its own isDesktop check), so these tests
// don't also need to stand up the underlying 'motion' scroll-linked animation machinery.
function mockNotDesktop() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
  mockNotDesktop();
  vi.useFakeTimers();
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

function buildFixture() {
  document.body.innerHTML = `
    <div>
      <span>Range</span>
      <span id="past-year-range-value"></span>
      <button type="button" id="past-year-reset" class="hidden">Reset</button>
      <div id="past-year-fill"></div>
      <input id="past-year-min" min="2019" max="2023" value="2019" />
      <input id="past-year-max" min="2019" max="2023" value="2023" />
    </div>

    <button type="button" data-filter-site="Camp Onas" aria-pressed="false">Camp Onas</button>
    <button type="button" data-filter-site="Pendle Hill" aria-pressed="false">Pendle Hill</button>

    <button type="button" id="clear-past-filters" class="hidden">Clear filters</button>
    <p data-past-empty-state class="hidden"></p>

    <ul id="past-events-grid">
      <li data-scroll-reveal="up" data-year="2019" data-site="Camp Onas">A</li>
      <li data-scroll-reveal="up" data-year="2021" data-site="Pendle Hill">B</li>
      <li data-scroll-reveal="up" data-year="2023" data-site="Camp Onas">C</li>
    </ul>
  `;
}

function visibleYears(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('#past-events-grid > li'))
    .filter((li) => !li.classList.contains('hidden'))
    .map((li) => li.dataset.year!);
}

describe('initPastEventsFiltersPage — setup', () => {
  it('does nothing when there is no #past-events-grid', async () => {
    document.body.innerHTML = '<button id="clear-past-filters"></button>';
    const { initPastEventsFiltersPage } = await import('./pastEventsFilters');
    expect(() => initPastEventsFiltersPage()).not.toThrow();
  });

  it('does not double-wire the same grid on a redundant astro:page-load', async () => {
    buildFixture();
    const { initPastEventsFiltersPage } = await import('./pastEventsFilters');
    initPastEventsFiltersPage();

    document.dispatchEvent(new Event('astro:page-load'));

    const siteBtn = document.querySelector<HTMLButtonElement>('[data-filter-site="Camp Onas"]')!;
    siteBtn.click();
    // A single click narrows to Camp Onas's two cards. If init had run twice, the second
    // listener attachment would toggle the selection back off on the same click.
    expect(visibleYears()).toEqual(['2019', '2023']);
  });
});

describe('initPastEventsFiltersPage — site filter', () => {
  it('filters to cards matching a selected site chip', async () => {
    buildFixture();
    const { initPastEventsFiltersPage } = await import('./pastEventsFilters');
    initPastEventsFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-filter-site="Camp Onas"]')!.click();

    expect(visibleYears()).toEqual(['2019', '2023']);
    expect(document.querySelector('[data-filter-site="Camp Onas"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('combines multiple selected site chips as OR', async () => {
    buildFixture();
    const { initPastEventsFiltersPage } = await import('./pastEventsFilters');
    initPastEventsFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-filter-site="Camp Onas"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-filter-site="Pendle Hill"]')!.click();

    expect(visibleYears()).toEqual(['2019', '2021', '2023']);
  });

  it('deselecting a chip removes it from the active filter', async () => {
    buildFixture();
    const { initPastEventsFiltersPage } = await import('./pastEventsFilters');
    initPastEventsFiltersPage();

    const btn = document.querySelector<HTMLButtonElement>('[data-filter-site="Camp Onas"]')!;
    btn.click();
    btn.click();

    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(visibleYears()).toEqual(['2019', '2021', '2023']);
  });

  it('shows the empty state and clear button once nothing matches', async () => {
    buildFixture();
    const { initPastEventsFiltersPage } = await import('./pastEventsFilters');
    initPastEventsFiltersPage();

    // Pendle Hill only has the 2021 card; narrowing the year floor past it leaves nothing.
    document.querySelector<HTMLButtonElement>('[data-filter-site="Pendle Hill"]')!.click();
    const minInput = document.getElementById('past-year-min') as HTMLInputElement;
    minInput.value = '2023';
    minInput.dispatchEvent(new Event('input'));

    expect(visibleYears()).toEqual([]);
    expect(document.querySelector('[data-past-empty-state]')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('clear-past-filters')!.classList.contains('hidden')).toBe(false);
  });
});

describe('initPastEventsFiltersPage — year range', () => {
  it('narrowing the min year excludes earlier cards', async () => {
    buildFixture();
    const { initPastEventsFiltersPage } = await import('./pastEventsFilters');
    initPastEventsFiltersPage();

    const minInput = document.getElementById('past-year-min') as HTMLInputElement;
    minInput.value = '2021';
    minInput.dispatchEvent(new Event('input'));

    expect(visibleYears()).toEqual(['2021', '2023']);
  });

  it('updates the rolling label and reveals the inline Reset link once narrowed', async () => {
    buildFixture();
    const { initPastEventsFiltersPage } = await import('./pastEventsFilters');
    initPastEventsFiltersPage();

    const minInput = document.getElementById('past-year-min') as HTMLInputElement;
    minInput.value = '2021';
    minInput.dispatchEvent(new Event('input'));
    // RollingLabel.setShape crossfades on a delay before rebuilding the label's content —
    // advance past it so the new text has actually rendered.
    await vi.advanceTimersByTimeAsync(200);

    expect(document.getElementById('past-year-range-value')!.textContent).toContain('2021');
    expect(document.getElementById('past-year-reset')!.classList.contains('hidden')).toBe(false);
  });

  it('the inline Reset link restores the full year range without touching site chips', async () => {
    buildFixture();
    const { initPastEventsFiltersPage } = await import('./pastEventsFilters');
    initPastEventsFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-filter-site="Camp Onas"]')!.click();
    const minInput = document.getElementById('past-year-min') as HTMLInputElement;
    minInput.value = '2021';
    minInput.dispatchEvent(new Event('input'));

    document.getElementById('past-year-reset')!.click();
    await vi.advanceTimersByTimeAsync(200);

    expect(minInput.value).toBe('2019');
    expect(document.getElementById('past-year-reset')!.classList.contains('hidden')).toBe(true);
    // Site filter is untouched by the year-only reset.
    expect(document.querySelector('[data-filter-site="Camp Onas"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(visibleYears()).toEqual(['2019', '2023']);
  });

  it('shows "All years" at the default bounds', async () => {
    buildFixture();
    const { initPastEventsFiltersPage } = await import('./pastEventsFilters');
    initPastEventsFiltersPage();
    await vi.advanceTimersByTimeAsync(200);

    expect(document.getElementById('past-year-range-value')!.textContent).toContain('All years');
  });
});

describe('initPastEventsFiltersPage — clear filters', () => {
  it('resets both the year range and site chips and hides itself', async () => {
    buildFixture();
    const { initPastEventsFiltersPage } = await import('./pastEventsFilters');
    initPastEventsFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-filter-site="Camp Onas"]')!.click();
    const minInput = document.getElementById('past-year-min') as HTMLInputElement;
    minInput.value = '2021';
    minInput.dispatchEvent(new Event('input'));

    document.getElementById('clear-past-filters')!.click();
    await vi.advanceTimersByTimeAsync(200);

    expect(minInput.value).toBe('2019');
    expect(document.querySelector('[data-filter-site="Camp Onas"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('clear-past-filters')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('past-year-reset')!.classList.contains('hidden')).toBe(true);
    expect(visibleYears()).toEqual(['2019', '2021', '2023']);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// initActivityFiltersPage() registers persistent listeners on the shared jsdom
// `document`/`window` (astro:page-load). Without removing them, listeners
// from earlier tests would keep firing and contaminate later tests.
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
  mockReducedMotion(false);
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
    <div id="activity-grid">
      <ul>
        <li><a data-activity-card href="/a"
          data-type="game" data-tags="fun,music" data-posture="active"
          data-group-min="4" data-group-max="10" data-search="capture the flag"></a></li>
        <li><a data-activity-card href="/b"
          data-type="dance" data-tags="circle,fun" data-meter="2/4" data-key="C"
          data-search="virginia reel"></a></li>
        <li><a data-activity-card href="/c"
          data-type="song" data-tags="camp" data-search="kumbaya"
          data-wheelchair-adaptable="true"></a></li>
      </ul>
    </div>

    <button data-filter-type="all">All</button>
    <button data-filter-type="game">Games</button>
    <button data-filter-type="dance">Dances</button>
    <button data-filter-type="song">Songs</button>

    <button data-filter-tag="fun">Fun</button>
    <button data-filter-tag="camp">Camp</button>

    <div data-filter-group>
      <button data-filter-posture="active" data-relevant-types="game">Active</button>
    </div>
    <div data-filter-group>
      <button data-filter-meter="2/4" data-relevant-types="dance,song">2/4</button>
    </div>
    <div data-filter-group>
      <button data-filter-key="C" data-relevant-types="dance,song">C</button>
    </div>

    <button id="filter-wheelchair-adaptable">Wheelchair</button>

    <div id="groupsize-filter-row">
      <input id="group-size-min" min="1" max="20" value="1" />
      <input id="group-size-max" min="1" max="20" value="20" />
      <span id="group-size-range-value"></span>
      <div id="group-size-fill"></div>
    </div>

    <input id="activity-search" />
    <button id="clear-all-filters" class="hidden"></button>
    <div data-empty-state hidden></div>
  `;
}

function visibleCards(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('li'))
    .filter((li) => !li.classList.contains('hidden'))
    .map((li) => li.querySelector('a')!.getAttribute('href')!);
}

describe('initActivityFiltersPage — setup', () => {
  it('does nothing when there is no #activity-grid', async () => {
    document.body.innerHTML = '<button id="clear-all-filters"></button>';
    const { initActivityFiltersPage } = await import('./activityFilters');
    expect(() => initActivityFiltersPage()).not.toThrow();
  });

  it('does not double-wire the same grid on a redundant astro:page-load', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    document.dispatchEvent(new Event('astro:page-load'));

    const gameBtn = document.querySelector<HTMLButtonElement>('[data-filter-type="game"]')!;
    gameBtn.click();
    // If init ran twice, apply() would have been wired twice but the visible-set
    // computation is idempotent either way — the real signal is that init didn't throw
    // and the grid's flag is set exactly once.
    const grid = document.getElementById('activity-grid')!;
    expect(grid.dataset.filtersInitialized).toBe('true');
    expect(visibleCards()).toEqual(['/a']);
  });
});

describe('initActivityFiltersPage — type filter', () => {
  it('shows only cards matching the selected type and marks the button active', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const gameBtn = document.querySelector<HTMLButtonElement>('[data-filter-type="game"]')!;
    gameBtn.click();

    expect(visibleCards()).toEqual(['/a']);
    expect(gameBtn.getAttribute('aria-pressed')).toBe('true');
    expect(gameBtn.classList.contains('bg-primary')).toBe(true);
  });

  it('returns to showing everything when "all" is reselected', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-filter-type="game"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-filter-type="all"]')!.click();

    expect(visibleCards()).toEqual(['/a', '/b', '/c']);
  });
});

describe('initActivityFiltersPage — tag filter (AND narrowing)', () => {
  it('narrows to cards containing the selected tag', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-filter-tag="fun"]')!.click();

    expect(visibleCards()).toEqual(['/a', '/b']);
  });

  it('combines multiple selected tags as AND', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-filter-tag="fun"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-filter-tag="camp"]')!.click();

    // No single card has both "fun" and "camp".
    expect(visibleCards()).toEqual([]);
  });

  it('toggling a tag back off restores the wider result set', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const funBtn = document.querySelector<HTMLButtonElement>('[data-filter-tag="fun"]')!;
    funBtn.click();
    funBtn.click();

    expect(funBtn.getAttribute('aria-pressed')).toBe('false');
    expect(visibleCards()).toEqual(['/a', '/b', '/c']);
  });
});

describe('initActivityFiltersPage — posture/meter/key OR groups', () => {
  it('filters by posture', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-filter-posture="active"]')!.click();

    expect(visibleCards()).toEqual(['/a']);
  });

  it('filters by meter', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-filter-meter="2/4"]')!.click();

    expect(visibleCards()).toEqual(['/b']);
  });

  it('filters by key', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-filter-key="C"]')!.click();

    expect(visibleCards()).toEqual(['/b']);
  });
});

describe('initActivityFiltersPage — facet relevance visibility', () => {
  it('hides facets irrelevant to the selected type and hides the whole group when nothing in it remains visible', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-filter-type="song"]')!.click();

    const postureBtn = document.querySelector<HTMLButtonElement>('[data-filter-posture="active"]')!;
    expect(postureBtn.classList.contains('hidden')).toBe(true);
    expect(postureBtn.closest('[data-filter-group]')!.classList.contains('hidden')).toBe(true);

    // Meter/key are relevant to "song" too, so they should stay visible.
    const meterBtn = document.querySelector<HTMLButtonElement>('[data-filter-meter="2/4"]')!;
    expect(meterBtn.classList.contains('hidden')).toBe(false);
  });

  it('clears an active selection when its facet becomes irrelevant to the newly selected type', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const postureBtn = document.querySelector<HTMLButtonElement>('[data-filter-posture="active"]')!;
    document.querySelector<HTMLButtonElement>('[data-filter-type="game"]')!.click();
    postureBtn.click();
    expect(postureBtn.getAttribute('aria-pressed')).toBe('true');

    // Switching to "dance" makes the posture chip (relevant-types="game") irrelevant;
    // its selection should be cleared so it stops constraining the filter.
    document.querySelector<HTMLButtonElement>('[data-filter-type="dance"]')!.click();

    expect(postureBtn.getAttribute('aria-pressed')).toBe('false');
    expect(visibleCards()).toEqual(['/b']);
  });

  it('hides and resets the group-size row for types outside game/dance', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const minInput = document.getElementById('group-size-min') as HTMLInputElement;
    minInput.value = '5';
    minInput.dispatchEvent(new Event('input'));

    document.querySelector<HTMLButtonElement>('[data-filter-type="song"]')!.click();

    expect(document.getElementById('groupsize-filter-row')!.classList.contains('hidden')).toBe(true);
    expect(minInput.value).toBe('1');
  });
});

describe('initActivityFiltersPage — group size range', () => {
  // Label phrasing itself (the "all"/"minOnly"/"maxOnly"/"between" shapes) is
  // exercised directly and generically in rangeSlider.test.ts — this just
  // confirms the fill bar moves as the min input changes.
  it('updates the fill position as the min input changes', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const minInput = document.getElementById('group-size-min') as HTMLInputElement;
    minInput.value = '6';
    minInput.dispatchEvent(new Event('input'));
    // Flushes RollingLabel's crossfade delay so the minOnly phrasing callback
    // actually runs (exercised here for coverage; its output is asserted in
    // rangeSlider.test.ts).
    await vi.advanceTimersByTimeAsync(200);

    expect((document.getElementById('group-size-fill') as HTMLElement).style.left).not.toBe('');
  });

  it('clamps the min handle so it never exceeds the max handle', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const minInput = document.getElementById('group-size-min') as HTMLInputElement;
    const maxInput = document.getElementById('group-size-max') as HTMLInputElement;
    maxInput.value = '5';
    minInput.value = '10';
    minInput.dispatchEvent(new Event('input'));

    expect(minInput.value).toBe('5');
  });

  it('clamps the max handle so it never drops below the min handle', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const minInput = document.getElementById('group-size-min') as HTMLInputElement;
    const maxInput = document.getElementById('group-size-max') as HTMLInputElement;
    minInput.value = '10';
    maxInput.value = '5';
    maxInput.dispatchEvent(new Event('input'));

    expect(maxInput.value).toBe('10');
  });

  it('narrowing the range excludes cards with no group-size data', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const minInput = document.getElementById('group-size-min') as HTMLInputElement;
    minInput.value = '2';
    minInput.dispatchEvent(new Event('input'));

    // Only card /a carries group-size data (4-10); /b and /c have none and are
    // excluded once the range narrows away from its full extent.
    expect(visibleCards()).toEqual(['/a']);
  });

  it('a narrowed range still includes a card whose [min,max] overlaps it', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const minInput = document.getElementById('group-size-min') as HTMLInputElement;
    const maxInput = document.getElementById('group-size-max') as HTMLInputElement;
    minInput.value = '5';
    maxInput.value = '8';
    minInput.dispatchEvent(new Event('input'));
    maxInput.dispatchEvent(new Event('input'));

    expect(visibleCards()).toEqual(['/a']);
  });
});

describe('initActivityFiltersPage — wheelchair filter', () => {
  it('shows only wheelchair-adaptable cards when toggled on', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    document.getElementById('filter-wheelchair-adaptable')!.click();

    expect(visibleCards()).toEqual(['/c']);
  });
});

describe('initActivityFiltersPage — search', () => {
  it('filters by a case-insensitive, trimmed substring match', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const input = document.getElementById('activity-search') as HTMLInputElement;
    input.value = '  Reel  ';
    input.dispatchEvent(new Event('input'));

    expect(visibleCards()).toEqual(['/b']);
  });
});

describe('initActivityFiltersPage — empty state and clear-all', () => {
  it('shows the empty state when no cards match', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const input = document.getElementById('activity-search') as HTMLInputElement;
    input.value = 'nonexistent-activity';
    input.dispatchEvent(new Event('input'));

    expect(document.querySelector('[data-empty-state]')!.classList.contains('hidden')).toBe(false);
    expect(visibleCards()).toEqual([]);
  });

  it('keeps the clear-all button hidden when no filters are active, and reveals it once one is', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const clearAll = document.getElementById('clear-all-filters')!;
    expect(clearAll.classList.contains('hidden')).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-filter-tag="fun"]')!.click();
    expect(clearAll.classList.contains('hidden')).toBe(false);
  });

  it('resets every filter dimension back to defaults', async () => {
    buildFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-filter-type="dance"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-filter-tag="fun"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-filter-meter="2/4"]')!.click();
    document.getElementById('filter-wheelchair-adaptable')!.click();
    const search = document.getElementById('activity-search') as HTMLInputElement;
    search.value = 'reel';
    search.dispatchEvent(new Event('input'));

    document.getElementById('clear-all-filters')!.click();
    await vi.advanceTimersByTimeAsync(200);

    expect(document.querySelector<HTMLButtonElement>('[data-filter-type="all"]')!.getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(document.querySelector<HTMLButtonElement>('[data-filter-tag="fun"]')!.getAttribute('aria-pressed')).toBe(
      'false'
    );
    expect(search.value).toBe('');
    expect(document.getElementById('group-size-range-value')!.textContent).toContain('Any size');
    expect(document.getElementById('clear-all-filters')!.classList.contains('hidden')).toBe(true);
    expect(visibleCards()).toEqual(['/a', '/b', '/c']);
  });
});

describe('initFiltersCollapse', () => {
  // jsdom does no layout, so the geometry the collapse logic reads is faked:
  // `sentinelTop` is where the panel's place in the flow sits relative to the
  // viewport (the panel sticks at 64px), the body is 300px tall when open,
  // and the spacer reports whatever height the script last gave it.
  let sentinelTop = 500;

  function buildCollapseFixture() {
    document.body.innerHTML = `
      <div id="filters-sentinel"></div>
      <div id="filters-panel" style="top: 64px">
        <button id="filters-toggle" aria-expanded="true"></button>
        <span id="filters-chevron"></span>
        <div id="filters-body"></div>
      </div>
      <div id="filters-spacer"></div>
      <div id="activity-grid"><ul></ul></div>
    `;
    sentinelTop = 500;
    const rect = (height: number, top = 0) => ({ top, height }) as DOMRect;
    const sentinel = document.getElementById('filters-sentinel')!;
    const body = document.getElementById('filters-body')!;
    const spacer = document.getElementById('filters-spacer')!;
    sentinel.getBoundingClientRect = () => rect(0, sentinelTop);
    body.getBoundingClientRect = () => rect(body.style.maxHeight ? parseFloat(body.style.maxHeight) : 300);
    Object.defineProperty(body, 'scrollHeight', { value: 300, configurable: true });
    spacer.getBoundingClientRect = () => rect(parseFloat(spacer.style.height) || 0);
  }

  // Scrolls the page to `y`, moving the panel's place in the flow with it.
  let currentY = 0;
  function scrollTo(y: number) {
    sentinelTop -= y - currentY;
    currentY = y;
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
    window.dispatchEvent(new Event('scroll'));
  }

  const isCollapsed = () => document.getElementById('filters-toggle')!.getAttribute('aria-expanded') === 'false';
  const spacerHeight = () => document.getElementById('filters-spacer')!.style.height;

  async function setup() {
    currentY = 0;
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
    buildCollapseFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();
  }

  it('does nothing when the panel markup is absent', async () => {
    document.body.innerHTML = '<div id="activity-grid"><ul></ul></div>';
    const { initActivityFiltersPage } = await import('./activityFilters');
    expect(() => initActivityFiltersPage()).not.toThrow();
  });

  it('toggles collapsed state on manual toggle click', async () => {
    await setup();
    const toggle = document.getElementById('filters-toggle')!;
    const body = document.getElementById('filters-body')!;

    toggle.click();
    expect(body.style.maxHeight).toBe('0px');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    expect(body.style.maxHeight).toBe('300px');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    // Once the transition settles, the open body goes back to its CSS cap.
    await vi.advanceTimersByTimeAsync(400);
    expect(body.style.maxHeight).toBe('');
  });

  it('does not collapse while the panel is still down the page, however far the reader scrolls', async () => {
    await setup();
    // The hero image keeps the panel below the fold for the first stretch.
    scrollTo(200);
    scrollTo(430);
    expect(isCollapsed()).toBe(false);
  });

  it('waits until the panel has been stuck for a little while before collapsing', async () => {
    await setup();
    scrollTo(446); // 10px past the stuck point
    expect(isCollapsed()).toBe(false);
    scrollTo(480); // 44px past
    expect(isCollapsed()).toBe(true);
  });

  it('holds the collapsed height in the spacer while stuck so the list does not move', async () => {
    await setup();
    scrollTo(600);
    expect(isCollapsed()).toBe(true);
    expect(spacerHeight()).toBe('300px');
  });

  it('does not hold space when the reader collapses the panel before it is stuck', async () => {
    await setup();
    document.getElementById('filters-toggle')!.click();
    expect(isCollapsed()).toBe(true);
    expect(spacerHeight()).toBe('0px');
  });

  it('keeps the panel collapsed through a small upward scroll mid-list', async () => {
    await setup();
    scrollTo(1200);
    expect(isCollapsed()).toBe(true);
    scrollTo(1140);
    expect(isCollapsed()).toBe(true);
  });

  it('reopens mid-list on a sustained upward scroll, giving the space back from the spacer', async () => {
    await setup();
    scrollTo(1200);
    expect(isCollapsed()).toBe(true);
    scrollTo(1150);
    expect(isCollapsed()).toBe(true);
    scrollTo(1100); // 100px of upward travel
    expect(isCollapsed()).toBe(false);
    expect(spacerHeight()).toBe('0px');
  });

  it('resets the upward accumulator on each direction change so jitter never reopens it', async () => {
    await setup();
    scrollTo(1200);
    for (let i = 0; i < 6; i++) {
      scrollTo(1160);
      scrollTo(1200);
    }
    expect(isCollapsed()).toBe(true);
  });

  it('reopens when the panel scrolls back into its place in the page', async () => {
    await setup();
    scrollTo(1200);
    expect(isCollapsed()).toBe(true);
    // Work back up in 50px hops, each followed by a 10px nudge down, so the
    // upward accumulator never reaches the mid-list reopen threshold.
    let y = 1200;
    while (y - 50 > 440) {
      y -= 50;
      scrollTo(y);
      scrollTo(y + 10);
    }
    expect(isCollapsed()).toBe(true);
    scrollTo(400); // panel back below its sticky offset
    expect(isCollapsed()).toBe(false);
    expect(spacerHeight()).toBe('0px');
  });

  it('leaves a panel the reader closed alone on upward scrolls and back at the top', async () => {
    await setup();
    document.getElementById('filters-toggle')!.click();
    scrollTo(1200);
    scrollTo(1000);
    expect(isCollapsed()).toBe(true);
    scrollTo(0);
    expect(isCollapsed()).toBe(true);
  });

  it('collapses again on scrolling down after the reader reopens it while stuck', async () => {
    await setup();
    scrollTo(1200);
    document.getElementById('filters-toggle')!.click();
    expect(isCollapsed()).toBe(false);
    scrollTo(1240);
    expect(isCollapsed()).toBe(true);
  });

  it('tears down the previous click listener on re-init so it does not double-fire', async () => {
    await setup();
    // A second init pass (as astro:page-load would trigger) must replace, not stack,
    // the toggle's click handler.
    document.dispatchEvent(new Event('astro:page-load'));

    document.getElementById('filters-toggle')!.click();

    // If the old listener were still attached too, two toggles would fire on one
    // click and net out to no visible change.
    expect(isCollapsed()).toBe(true);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// initActivityFiltersPage() registers persistent listeners on the shared jsdom
// `document`/`window` (astro:page-load, scroll). Without removing them, listeners
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
  function buildCollapseFixture() {
    document.body.innerHTML = `
      <div id="filters-panel">
        <button id="filters-toggle" aria-expanded="true"></button>
        <span id="filters-chevron"></span>
        <div id="filters-body"></div>
      </div>
      <div id="activity-grid"><ul></ul></div>
    `;
  }

  function scrollTo(y: number) {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
    window.dispatchEvent(new Event('scroll'));
  }

  it('does nothing when the panel markup is absent', async () => {
    document.body.innerHTML = '<div id="activity-grid"><ul></ul></div>';
    const { initActivityFiltersPage } = await import('./activityFilters');
    expect(() => initActivityFiltersPage()).not.toThrow();
  });

  it('toggles collapsed state on manual toggle click', async () => {
    buildCollapseFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const toggle = document.getElementById('filters-toggle')!;
    const body = document.getElementById('filters-body')!;

    toggle.click();
    expect(body.classList.contains('max-h-0')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    expect(body.classList.contains('max-h-0')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses on a downward scroll past the threshold, expands again near the top', async () => {
    buildCollapseFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const body = document.getElementById('filters-body')!;

    scrollTo(200);
    expect(body.classList.contains('max-h-0')).toBe(true);

    // Past the post-toggle suppression window, so this scroll is evaluated for real.
    await vi.advanceTimersByTimeAsync(500);
    scrollTo(50);
    expect(body.classList.contains('max-h-0')).toBe(false);
  });

  it('does not collapse for a downward scroll that has not passed the scroll threshold', async () => {
    buildCollapseFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    scrollTo(5);
    expect(document.getElementById('filters-body')!.classList.contains('max-h-0')).toBe(false);
  });

  it('ignores a scroll event that does not move the page', async () => {
    buildCollapseFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const body = document.getElementById('filters-body')!;
    scrollTo(300);
    expect(body.classList.contains('max-h-0')).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    // Same scrollY — delta is zero, so nothing should change.
    scrollTo(300);
    expect(body.classList.contains('max-h-0')).toBe(true);
  });

  it('keeps the panel collapsed when a small upward scroll is still well below the page fold', async () => {
    buildCollapseFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const body = document.getElementById('filters-body')!;
    scrollTo(600);
    expect(body.classList.contains('max-h-0')).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    // A 40px correction: not near the top, not a sustained gesture — panel stays put.
    scrollTo(560);
    expect(body.classList.contains('max-h-0')).toBe(true);
  });

  it('re-expands mid-page once the upward scroll is sustained past the expand threshold', async () => {
    buildCollapseFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const body = document.getElementById('filters-body')!;
    scrollTo(600);
    expect(body.classList.contains('max-h-0')).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    // Two upward steps in the same direction accumulate to 80px (> the 72px
    // expand threshold) while still far below the fold.
    scrollTo(560);
    expect(body.classList.contains('max-h-0')).toBe(true);
    scrollTo(520);
    expect(body.classList.contains('max-h-0')).toBe(false);
  });

  it('resets the accumulator on each direction change so momentum rebound never re-expands', async () => {
    buildCollapseFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    const body = document.getElementById('filters-body')!;
    scrollTo(600);
    expect(body.classList.contains('max-h-0')).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    // Alternating small jitters, each flipping direction — none accumulates.
    scrollTo(585);
    scrollTo(600);
    scrollTo(585);
    scrollTo(600);
    expect(body.classList.contains('max-h-0')).toBe(true);
  });

  it('tears down the previous scroll/click listeners on re-init so they do not double-fire', async () => {
    buildCollapseFixture();
    const { initActivityFiltersPage } = await import('./activityFilters');
    initActivityFiltersPage();

    // A second init pass (as astro:page-load would trigger) must replace, not stack,
    // the toggle's click handler.
    document.dispatchEvent(new Event('astro:page-load'));

    const toggle = document.getElementById('filters-toggle')!;
    const body = document.getElementById('filters-body')!;

    toggle.click();

    // If the old listener were still attached too, two toggles would fire on one
    // click and net out to no visible change.
    expect(body.classList.contains('max-h-0')).toBe(true);
  });
});

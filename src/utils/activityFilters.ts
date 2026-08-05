import { RollingLabel } from '~/utils/numberRoll';

// Client-side facet filter over the already-rendered card set — deliberately
// independent of the pagefind search modal (see Header.astro / PagefindConfig),
// which has its own history of breaking across Astro View Transitions.
function initActivityFilters() {
  const grid = document.getElementById('activity-grid');
  if (!grid) return;
  // astro:page-load fires even on the very first load (in addition to the
  // direct call below), which would otherwise wire every listener in this
  // function twice on the same DOM. A real navigation swaps in a fresh grid
  // element (without this flag), so re-init still happens correctly then.
  if (grid.dataset.filtersInitialized === 'true') return;
  grid.dataset.filtersInitialized = 'true';

  const cards = Array.from(grid.querySelectorAll<HTMLAnchorElement>('[data-activity-card]'));
  const typeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-filter-type]'));
  const tagButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-filter-tag]'));
  const postureButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-filter-posture]'));
  const meterButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-filter-meter]'));
  const keyButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-filter-key]'));
  const wheelchairButton = document.getElementById('filter-wheelchair-adaptable') as HTMLButtonElement | null;
  const relevanceButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-relevant-types]'));
  const filterGroups = Array.from(document.querySelectorAll<HTMLElement>('[data-filter-group]'));
  const groupSizeRow = document.getElementById('groupsize-filter-row');
  const groupSizeMinInput = document.getElementById('group-size-min') as HTMLInputElement | null;
  const groupSizeMaxInput = document.getElementById('group-size-max') as HTMLInputElement | null;
  const groupSizeRangeValue = document.getElementById('group-size-range-value');
  const groupSizeFill = document.getElementById('group-size-fill');
  const searchInput = document.getElementById('activity-search') as HTMLInputElement | null;
  const clearAllButton = document.getElementById('clear-all-filters') as HTMLButtonElement | null;
  const emptyState = document.querySelector<HTMLElement>('[data-empty-state]');

  let activeType = 'all';
  const activeTags = new Set<string>();
  const activePostures = new Set<string>();
  const activeMeters = new Set<string>();
  const activeKeys = new Set<string>();
  let wheelchairOnly = false;
  let searchQuery = '';
  const groupSizeLabel = groupSizeRangeValue ? new RollingLabel(groupSizeRangeValue) : null;

  // Only games/dances carry structured group-size data; the
  // slider row hides (and resets) itself for other types, same as the
  // meter/key chip groups.
  const GROUP_SIZE_RELEVANT_TYPES = ['game', 'dance'];
  const groupSizeBoundMin = groupSizeMinInput ? Number(groupSizeMinInput.min) : 1;
  const groupSizeBoundMax = groupSizeMinInput ? Number(groupSizeMinInput.max) : 1;

  function setActive(btn: HTMLButtonElement, active: boolean) {
    btn.classList.toggle('bg-primary', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('border-primary', active);
    btn.classList.toggle('border-gray-200', !active);
    btn.classList.toggle('dark:border-gray-700', !active);
    btn.classList.toggle('text-default', !active);
    btn.setAttribute('aria-pressed', String(active));
  }

  // Wires a group of chips where each activity can only have one value for
  // the field (posture, key, meter) — so multiple selections combine as OR.
  // Contrast with tags below, where an activity can have several tags at
  // once, so multiple selections there combine as AND (narrowing).
  function wireOrGroup(buttons: HTMLButtonElement[], datasetKey: string, activeSet: Set<string>) {
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = btn.dataset[datasetKey]!;
        if (activeSet.has(value)) {
          activeSet.delete(value);
          setActive(btn, false);
        } else {
          activeSet.add(value);
          setActive(btn, true);
        }
        apply();
      });
    });
  }

  // Deactivates a chip and removes its value from whichever facet Set it belongs to —
  // used when a chip is hidden because it no longer applies to the selected type.
  function clearSelection(btn: HTMLButtonElement) {
    if (btn.dataset.filterPosture !== undefined) activePostures.delete(btn.dataset.filterPosture);
    else if (btn.dataset.filterMeter !== undefined) activeMeters.delete(btn.dataset.filterMeter);
    else if (btn.dataset.filterKey !== undefined) activeKeys.delete(btn.dataset.filterKey);
    else if (btn === wheelchairButton) wheelchairOnly = false;
    setActive(btn, false);
  }

  // Crossfades the whole label when its sentence shape changes (e.g. "Any
  // size" → "At least X people"), since that means rebuilding the DOM.
  // When the shape stays the same, only the changed number(s) roll — the
  // surrounding phrase text never re-renders. See src/utils/numberRoll.ts.
  function updateGroupSizeDisplay() {
    if (!groupSizeMinInput || !groupSizeMaxInput) return;
    const minVal = Number(groupSizeMinInput.value);
    const maxVal = Number(groupSizeMaxInput.value);

    if (groupSizeLabel) {
      const minSet = minVal > groupSizeBoundMin;
      const maxSet = maxVal < groupSizeBoundMax;
      const shape = minSet && maxSet ? 'between' : minSet ? 'atLeast' : maxSet ? 'noMoreThan' : 'any';

      const rebuilt = groupSizeLabel.setShape(shape, (label) => {
        if (shape === 'any') {
          label.text('Any size');
        } else if (shape === 'atLeast') {
          label.text('At least ');
          label.reel('min', minVal);
          label.text(' people');
        } else if (shape === 'noMoreThan') {
          label.text('No more than ');
          label.reel('max', maxVal);
          label.text(' people');
        } else {
          label.text('Between ');
          label.reel('min', minVal);
          label.text(' and ');
          label.reel('max', maxVal);
          label.text(' people');
        }
      });
      if (!rebuilt && shape !== 'any') {
        groupSizeLabel.roll('min', minVal);
        groupSizeLabel.roll('max', maxVal);
      }
    }

    if (groupSizeFill) {
      const span = Math.max(1, groupSizeBoundMax - groupSizeBoundMin);
      const leftPct = ((minVal - groupSizeBoundMin) / span) * 100;
      const rightPct = 100 - ((maxVal - groupSizeBoundMin) / span) * 100;
      groupSizeFill.style.left = `${leftPct}%`;
      groupSizeFill.style.right = `${rightPct}%`;
    }

    // When the two thumbs coincide, the max input (later in the DOM) is on
    // top and wins the pointer. That deadlocks at the far right: max can't
    // move further and min is buried. Putting min on top whenever the pair
    // sits in the upper half of the range keeps a movable thumb grabbable
    // at both extremes.
    groupSizeMinInput.classList.toggle('z-10', minVal > (groupSizeBoundMin + groupSizeBoundMax) / 2);
  }

  // Some facets only make sense for certain activity types (e.g. Meter/Key only
  // apply to dances/songs). Hide chips that don't apply to the selected type,
  // clearing any selection they held, then hide whole groups left with nothing visible.
  function updateFacetVisibility() {
    for (const btn of relevanceButtons) {
      const types = btn.dataset.relevantTypes!.split(',');
      const relevant = activeType === 'all' || types.includes(activeType);
      if (!relevant && btn.getAttribute('aria-pressed') === 'true') clearSelection(btn);
      btn.classList.toggle('hidden', !relevant);
    }
    for (const group of filterGroups) {
      const buttons = Array.from(group.querySelectorAll('button'));
      const anyVisible = buttons.some((b) => !b.classList.contains('hidden'));
      group.classList.toggle('hidden', !anyVisible);
    }

    // The group-size slider row isn't button-based, so it's handled separately
    // from the generic chip-relevance logic above.
    if (groupSizeRow) {
      const relevant = activeType === 'all' || GROUP_SIZE_RELEVANT_TYPES.includes(activeType);
      if (!relevant) {
        if (groupSizeMinInput) groupSizeMinInput.value = String(groupSizeBoundMin);
        if (groupSizeMaxInput) groupSizeMaxInput.value = String(groupSizeBoundMax);
        updateGroupSizeDisplay();
      }
      groupSizeRow.classList.toggle('hidden', !relevant);
    }
  }

  function isAnyFilterActive(): boolean {
    const selMin = groupSizeMinInput ? Number(groupSizeMinInput.value) : groupSizeBoundMin;
    const selMax = groupSizeMaxInput ? Number(groupSizeMaxInput.value) : groupSizeBoundMax;
    return (
      activeType !== 'all' ||
      activeTags.size > 0 ||
      activePostures.size > 0 ||
      activeMeters.size > 0 ||
      activeKeys.size > 0 ||
      wheelchairOnly ||
      selMin > groupSizeBoundMin ||
      selMax < groupSizeBoundMax ||
      searchQuery !== ''
    );
  }

  function apply() {
    let visibleCount = 0;
    for (const card of cards) {
      const cardType = card.dataset.type ?? '';
      const cardTags = (card.dataset.tags ?? '').split(',').filter(Boolean);
      const cardPosture = card.dataset.posture ?? '';
      const cardMeter = card.dataset.meter ?? '';
      const cardKey = card.dataset.key ?? '';
      const cardGroupMin = card.dataset.groupMin ?? '';
      const cardGroupMax = card.dataset.groupMax ?? '';
      const cardSearch = card.dataset.search ?? '';
      const matchesType = activeType === 'all' || cardType === activeType;
      // Each selected tag narrows the results (AND), the standard faceted-filter behavior.
      const matchesTags = [...activeTags].every((t) => cardTags.includes(t));
      // Posture/meter/key are single-valued, so selections within each group are OR.
      const matchesPosture = activePostures.size === 0 || activePostures.has(cardPosture);
      const matchesMeter = activeMeters.size === 0 || activeMeters.has(cardMeter);
      const matchesKey = activeKeys.size === 0 || activeKeys.has(cardKey);
      // Group size is a range, so a card matches when its [min, max] overlaps the
      // selected slider range. At full extents (no narrowing), everything matches,
      // including cards with no size data — narrowing excludes cards with no data,
      // since we can't confirm they'd fit.
      const selMin = groupSizeMinInput ? Number(groupSizeMinInput.value) : groupSizeBoundMin;
      const selMax = groupSizeMaxInput ? Number(groupSizeMaxInput.value) : groupSizeBoundMax;
      const groupSizeFilterActive = selMin > groupSizeBoundMin || selMax < groupSizeBoundMax;
      let matchesGroupSize = !groupSizeFilterActive;
      if (groupSizeFilterActive && (cardGroupMin !== '' || cardGroupMax !== '')) {
        const cardMin = cardGroupMin !== '' ? Number(cardGroupMin) : 1;
        const cardMax = cardGroupMax !== '' ? Number(cardGroupMax) : Infinity;
        const effectiveSelMax = selMax >= groupSizeBoundMax ? Infinity : selMax;
        matchesGroupSize = cardMin <= effectiveSelMax && cardMax >= selMin;
      }
      const matchesWheelchair = !wheelchairOnly || card.dataset.wheelchairAdaptable === 'true';
      const matchesSearch = searchQuery === '' || cardSearch.includes(searchQuery);
      const visible =
        matchesType &&
        matchesTags &&
        matchesPosture &&
        matchesMeter &&
        matchesKey &&
        matchesGroupSize &&
        matchesWheelchair &&
        matchesSearch;
      card.closest('li')!.classList.toggle('hidden', !visible);
      if (visible) visibleCount++;
    }
    emptyState?.classList.toggle('hidden', visibleCount !== 0);
    clearAllButton?.classList.toggle('hidden', !isAnyFilterActive());
  }

  function resetAllFilters() {
    activeType = 'all';
    typeButtons.forEach((b) => setActive(b, b.dataset.filterType === 'all'));

    activeTags.clear();
    tagButtons.forEach((b) => setActive(b, false));

    activePostures.clear();
    postureButtons.forEach((b) => setActive(b, false));

    activeMeters.clear();
    meterButtons.forEach((b) => setActive(b, false));

    activeKeys.clear();
    keyButtons.forEach((b) => setActive(b, false));

    wheelchairOnly = false;
    if (wheelchairButton) setActive(wheelchairButton, false);

    if (groupSizeMinInput) groupSizeMinInput.value = String(groupSizeBoundMin);
    if (groupSizeMaxInput) groupSizeMaxInput.value = String(groupSizeBoundMax);
    updateGroupSizeDisplay();

    if (searchInput) searchInput.value = '';
    searchQuery = '';

    updateFacetVisibility();
    apply();
  }

  typeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeType = btn.dataset.filterType!;
      typeButtons.forEach((b) => setActive(b, b === btn));
      updateFacetVisibility();
      apply();
    });
  });

  tagButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.filterTag!;
      if (activeTags.has(tag)) {
        activeTags.delete(tag);
        setActive(btn, false);
      } else {
        activeTags.add(tag);
        setActive(btn, true);
      }
      apply();
    });
  });

  wireOrGroup(postureButtons, 'filterPosture', activePostures);
  wireOrGroup(meterButtons, 'filterMeter', activeMeters);
  wireOrGroup(keyButtons, 'filterKey', activeKeys);

  wheelchairButton?.addEventListener('click', () => {
    wheelchairOnly = !wheelchairOnly;
    setActive(wheelchairButton, wheelchairOnly);
    apply();
  });

  groupSizeMinInput?.addEventListener('input', () => {
    if (groupSizeMaxInput && Number(groupSizeMinInput.value) > Number(groupSizeMaxInput.value)) {
      groupSizeMinInput.value = groupSizeMaxInput.value;
    }
    updateGroupSizeDisplay();
    apply();
  });

  groupSizeMaxInput?.addEventListener('input', () => {
    if (groupSizeMinInput && Number(groupSizeMaxInput.value) < Number(groupSizeMinInput.value)) {
      groupSizeMaxInput.value = groupSizeMinInput.value;
    }
    updateGroupSizeDisplay();
    apply();
  });

  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    apply();
  });

  clearAllButton?.addEventListener('click', resetAllFilters);

  updateGroupSizeDisplay();
  updateFacetVisibility();
}

// The filters panel is sticky (see #filters-panel) so it stays reachable while
// browsing the list, but a fully-expanded panel pinned at the top would eat a
// lot of the viewport. Collapse it to just the toggle bar once the reader
// scrolls down, expand again on any upward scroll — the same direction-based
// pattern used by hide-on-scroll headers. Manual toggle always works too.
// astro:page-load fires even on the very first load (in addition to the direct
// call below), so this must tear down its own previous listeners before
// re-attaching — otherwise two independent closures, each with their own
// `collapsed` state, end up fighting over the same DOM classes.
let cleanupFiltersCollapse: (() => void) | null = null;

function initFiltersCollapse() {
  cleanupFiltersCollapse?.();
  cleanupFiltersCollapse = null;

  const panel = document.getElementById('filters-panel');
  const toggle = document.getElementById('filters-toggle') as HTMLButtonElement | null;
  const body = document.getElementById('filters-body');
  const chevron = document.getElementById('filters-chevron');
  if (!panel || !toggle || !body || !chevron) return;

  const COLLAPSE_SCROLL_THRESHOLD = 150;
  // Collapsing/expanding resizes this sticky element's flow height, which
  // can shift the document's scrollable height enough that the browser
  // clamps/adjusts scrollY on its own — firing a native scroll event that
  // would otherwise be mistaken for user input and immediately re-trigger
  // the opposite state (an infinite loop). Suppress scroll evaluation
  // briefly (covering the transition duration) after any programmatic change.
  const SCROLL_SUPPRESS_MS = 400;
  let collapsed = false;
  let suppressScrollUntil = 0;

  function setCollapsed(next: boolean) {
    if (next === collapsed) return;
    collapsed = next;
    body!.classList.toggle('max-h-[min(600px,calc(100dvh-10rem))]', !collapsed);
    body!.classList.toggle('max-h-0', collapsed);
    chevron!.classList.toggle('rotate-180', !collapsed);
    toggle!.setAttribute('aria-expanded', String(!collapsed));
    suppressScrollUntil = Date.now() + SCROLL_SUPPRESS_MS;
    lastScrollY = window.scrollY;
  }

  function onToggleClick() {
    setCollapsed(!collapsed);
  }
  toggle.addEventListener('click', onToggleClick);

  // Ignore tiny scroll deltas (sub-pixel jitter, a focus/click-induced
  // scroll-into-view nudge) so they can't be mistaken for a deliberate
  // scroll gesture and flip the collapse state unexpectedly. Genuine slow
  // scrolling still accumulates against the stale lastScrollY reference
  // until it crosses the threshold.
  const SCROLL_NOISE_THRESHOLD = 15;
  let lastScrollY = window.scrollY;
  function onScroll() {
    const y = window.scrollY;
    if (Date.now() < suppressScrollUntil) {
      lastScrollY = y;
      return;
    }
    const delta = y - lastScrollY;
    if (Math.abs(delta) < SCROLL_NOISE_THRESHOLD) return;
    const scrollingDown = delta > 0;
    if (scrollingDown && y > COLLAPSE_SCROLL_THRESHOLD) setCollapsed(true);
    else if (!scrollingDown) setCollapsed(false);
    lastScrollY = y;
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  cleanupFiltersCollapse = () => {
    toggle.removeEventListener('click', onToggleClick);
    window.removeEventListener('scroll', onScroll);
  };
}

export function initActivityFiltersPage(): void {
  initActivityFilters();
  initFiltersCollapse();
  document.addEventListener('astro:page-load', () => {
    initActivityFilters();
    initFiltersCollapse();
  });
}

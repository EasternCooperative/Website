import { RollingLabel } from '~/utils/numberRoll';
import { RangeSliderControl, updateRangeLabel } from '~/utils/rangeSlider';
import { initScrollReveal } from '~/utils/scrollReveal';

// Client-side filtering for the past-events grid on /events — a year range
// slider (rolodex label, shared with the Activities group-size filter and the
// Gallery year filter — see updateRangeLabel in rangeSlider.ts) plus OR-group
// site chips, applied over the already-rendered card set.
function initPastEventsFilters() {
  const grid = document.getElementById('past-events-grid');
  if (!grid) return;
  // astro:page-load fires even on the very first load (in addition to the
  // direct call below), which would otherwise wire every listener twice on
  // the same DOM. A real navigation swaps in a fresh grid element (without
  // this flag), so re-init still happens correctly then.
  if (grid.dataset.filtersInitialized === 'true') return;
  grid.dataset.filtersInitialized = 'true';

  const items = Array.from(grid.querySelectorAll<HTMLLIElement>('li[data-year]'));
  const siteButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-filter-site]'));
  const clearButton = document.getElementById('clear-past-filters') as HTMLButtonElement | null;
  const emptyState = document.querySelector<HTMLElement>('[data-past-empty-state]');
  const yearMinInput = document.getElementById('past-year-min') as HTMLInputElement | null;
  const yearMaxInput = document.getElementById('past-year-max') as HTMLInputElement | null;
  const yearFill = document.getElementById('past-year-fill');
  const yearRangeValue = document.getElementById('past-year-range-value');
  const yearResetButton = document.getElementById('past-year-reset') as HTMLButtonElement | null;

  const activeSites = new Set<string>();
  const yearLabel = yearRangeValue ? new RollingLabel(yearRangeValue) : null;
  const yearBoundMin = yearMinInput ? Number(yearMinInput.min) : 0;
  const yearBoundMax = yearMinInput ? Number(yearMinInput.max) : 0;

  const yearSlider =
    yearMinInput && yearMaxInput && yearFill
      ? new RangeSliderControl(
          { minInput: yearMinInput, maxInput: yearMaxInput, fill: yearFill },
          {
            boundMin: yearBoundMin,
            boundMax: yearBoundMax,
            onChange: (min, max) => {
              updateYearLabel(min, max);
              updateYearResetVisibility(min, max);
              apply();
            },
          }
        )
      : null;

  // Mirrors the inline "Reset" link on the React RangeSlider (src/components/ui/RangeSlider.tsx,
  // used on /gallery) — a narrow-scoped reset for just this one slider, shown only once it's
  // been moved off its full bounds, distinct from the page-wide "Clear filters" button below.
  function updateYearResetVisibility(min: number, max: number) {
    yearResetButton?.classList.toggle('hidden', !(min > yearBoundMin || max < yearBoundMax));
  }

  function updateYearLabel(min: number, max: number) {
    if (!yearLabel) return;
    updateRangeLabel(yearLabel, min, max, yearBoundMin, yearBoundMax, {
      all: (l) => l.text('All years'),
      minOnly: (l, min) => {
        l.text('Since ');
        l.reel('min', min);
      },
      maxOnly: (l, max) => {
        l.text('Through ');
        l.reel('max', max);
      },
      between: (l, min, max) => {
        l.reel('min', min);
        l.text(' – ');
        l.reel('max', max);
      },
    });
  }

  function setActive(btn: HTMLButtonElement, active: boolean) {
    btn.classList.toggle('bg-primary', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('border-primary', active);
    btn.classList.toggle('border-gray-200', !active);
    btn.classList.toggle('dark:border-gray-700', !active);
    btn.classList.toggle('text-default', !active);
    btn.setAttribute('aria-pressed', String(active));
  }

  function isAnyFilterActive(): boolean {
    const selMin = yearSlider?.min ?? yearBoundMin;
    const selMax = yearSlider?.max ?? yearBoundMax;
    return activeSites.size > 0 || selMin > yearBoundMin || selMax < yearBoundMax;
  }

  // Toggling `hidden` moves cards on-page (via the grid reflow) without a
  // scroll event, but the scroll-linked reveal animation wired on first load
  // (see scrollReveal.ts) is bound to each card's position at wire-time and
  // only recomputes on real scrolling — so a card re-shown by a filter change
  // would otherwise sit stuck at opacity 0 until the reader scrolls. Cancel
  // those stale bindings and let scrollReveal re-derive state from the card's
  // new position, same fix as the People page's refreshScrollReveal.
  function refreshScrollReveal() {
    for (const item of items) {
      item.getAnimations?.().forEach((anim) => anim.cancel());
      delete item.dataset.scrollRevealReady;
    }
    initScrollReveal(grid!);
  }

  function apply() {
    const selMin = yearSlider?.min ?? yearBoundMin;
    const selMax = yearSlider?.max ?? yearBoundMax;
    let visibleCount = 0;
    for (const item of items) {
      const year = Number(item.dataset.year);
      const site = item.dataset.site ?? '';
      const matchesYear = year >= selMin && year <= selMax;
      // Sites are single-valued per event, so multiple selected chips combine as OR.
      const matchesSite = activeSites.size === 0 || activeSites.has(site);
      const visible = matchesYear && matchesSite;
      item.classList.toggle('hidden', !visible);
      if (visible) visibleCount++;
    }
    emptyState?.classList.toggle('hidden', visibleCount !== 0);
    clearButton?.classList.toggle('hidden', !isAnyFilterActive());
    refreshScrollReveal();
  }

  siteButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const site = btn.dataset.filterSite!;
      if (activeSites.has(site)) {
        activeSites.delete(site);
        setActive(btn, false);
      } else {
        activeSites.add(site);
        setActive(btn, true);
      }
      apply();
    });
  });

  yearResetButton?.addEventListener('click', () => {
    yearSlider?.setValues(yearBoundMin, yearBoundMax);
    updateYearLabel(yearBoundMin, yearBoundMax);
    updateYearResetVisibility(yearBoundMin, yearBoundMax);
    apply();
  });

  clearButton?.addEventListener('click', () => {
    activeSites.clear();
    siteButtons.forEach((b) => setActive(b, false));
    yearSlider?.setValues(yearBoundMin, yearBoundMax);
    updateYearLabel(yearBoundMin, yearBoundMax);
    updateYearResetVisibility(yearBoundMin, yearBoundMax);
    apply();
  });

  updateYearLabel(yearSlider?.min ?? yearBoundMin, yearSlider?.max ?? yearBoundMax);
  updateYearResetVisibility(yearSlider?.min ?? yearBoundMin, yearSlider?.max ?? yearBoundMax);
  apply();
}

export function initPastEventsFiltersPage(): void {
  initPastEventsFilters();
  document.addEventListener('astro:page-load', () => {
    initPastEventsFilters();
  });
}

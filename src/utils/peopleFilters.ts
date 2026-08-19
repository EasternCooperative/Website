import { initScrollReveal } from './scrollReveal';

// Client-side sort + filter over the already-rendered People page card set.
// "Balanced" restores each list's original (server-rendered) order — the
// bio-length row-balancing computed in our-people.astro — rather than
// re-sorting, so no weight data needs to travel to the client.
type SortMode = 'balanced' | 'az' | 'za';

// Once a reader has deliberately toggled name-only visibility, remember it across
// visits rather than reverting to the site-wide default every time.
const NAME_ONLY_STORAGE_KEY = 'ecrs-people-show-name-only';

function readStoredNameOnly(): boolean | null {
  try {
    const stored = localStorage.getItem(NAME_ONLY_STORAGE_KEY);
    return stored === null ? null : stored === 'true';
  } catch {
    return null;
  }
}

function writeStoredNameOnly(value: boolean): void {
  try {
    localStorage.setItem(NAME_ONLY_STORAGE_KEY, String(value));
  } catch {
    // Storage unavailable (private browsing, disabled) — the toggle still
    // works for the current page view, it just won't persist.
  }
}

function initPeopleFilters() {
  const lists = Array.from(document.querySelectorAll<HTMLElement>('[data-people-list]'));
  if (lists.length === 0) return;
  // astro:page-load fires even on the very first load (in addition to the
  // direct call below), which would otherwise wire every listener in this
  // function twice on the same DOM. A real navigation swaps in fresh list
  // elements (without this flag), so re-init still happens correctly then.
  if (lists[0].dataset.filtersInitialized === 'true') return;
  lists.forEach((list) => (list.dataset.filtersInitialized = 'true'));

  const listStates = lists.map((list) => ({
    list,
    // Captured once, before any sorting — this is the "Balanced" order.
    balancedOrder: Array.from(list.querySelectorAll<HTMLElement>('[data-person-card]')),
  }));

  const sortButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-people-sort]'));
  const nameOnlyToggle = document.getElementById('people-filter-name-only') as HTMLButtonElement | null;
  const searchInput = document.getElementById('people-search') as HTMLInputElement | null;
  const emptyState = document.querySelector<HTMLElement>('[data-people-empty]');

  let sortMode: SortMode = 'balanced';
  const storedNameOnly = readStoredNameOnly();
  let includeNameOnly = storedNameOnly ?? nameOnlyToggle?.getAttribute('aria-pressed') === 'true';
  let searchQuery = '';

  function setActive(btn: HTMLButtonElement, active: boolean) {
    btn.classList.toggle('bg-primary', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('border-primary', active);
    btn.classList.toggle('border-gray-200', !active);
    btn.classList.toggle('dark:border-gray-700', !active);
    btn.classList.toggle('text-default', !active);
    btn.setAttribute('aria-pressed', String(active));
  }

  function applySort() {
    for (const { list, balancedOrder } of listStates) {
      const ordered =
        sortMode === 'balanced'
          ? balancedOrder
          : [...balancedOrder].sort((a, b) => {
              const cmp = (a.dataset.name ?? '').localeCompare(b.dataset.name ?? '', undefined, {
                sensitivity: 'base',
              });
              return sortMode === 'az' ? cmp : -cmp;
            });
      for (const card of ordered) list.appendChild(card);

      // Reordering moves each card to a new on-page position, but the scroll-linked
      // reveal animation wired on first load (see scrollReveal.ts) is bound to the
      // card's position at wire-time — it only recomputes on a real scroll event, so a
      // card that becomes already-visible purely from being moved would otherwise sit
      // at opacity 0 until the reader scrolls. Cancel those stale bindings and let
      // scrollReveal re-derive each card's state from its new position: instantly
      // visible if it's now on-screen, freshly (and correctly) scroll-linked if not.
      for (const card of ordered) {
        // getAnimations() isn't implemented in every test/runtime environment
        // (e.g. jsdom) — harmless to skip there since there's nothing to cancel.
        card.getAnimations?.().forEach((anim) => anim.cancel());
        delete card.dataset.scrollRevealReady;
      }
      initScrollReveal(list);
    }
  }

  function applyFilter() {
    let totalVisible = 0;
    for (const { list } of listStates) {
      const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-person-card]'));
      let visibleInList = 0;
      for (const card of cards) {
        const matchesProfile = includeNameOnly || card.dataset.hasProfile === 'true';
        const matchesSearch = searchQuery === '' || (card.dataset.name ?? '').toLowerCase().includes(searchQuery);
        const visible = matchesProfile && matchesSearch;
        card.classList.toggle('hidden', !visible);
        if (visible) visibleInList++;
      }
      list.closest<HTMLElement>('[data-people-section]')?.classList.toggle('hidden', visibleInList === 0);
      totalVisible += visibleInList;
    }
    emptyState?.classList.toggle('hidden', totalVisible !== 0);
  }

  sortButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      sortMode = btn.dataset.peopleSort as SortMode;
      sortButtons.forEach((b) => setActive(b, b === btn));
      applySort();
    });
  });

  nameOnlyToggle?.addEventListener('click', () => {
    includeNameOnly = !includeNameOnly;
    setActive(nameOnlyToggle, includeNameOnly);
    writeStoredNameOnly(includeNameOnly);
    applyFilter();
  });

  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    applyFilter();
  });

  // A stored preference can disagree with the server-rendered default (e.g. the
  // reader chose "show" on a prior visit, but cards without a profile were
  // rendered hidden this time) — reconcile the toggle's look and the cards'
  // visibility once, on init.
  if (
    nameOnlyToggle &&
    storedNameOnly !== null &&
    storedNameOnly !== (nameOnlyToggle.getAttribute('aria-pressed') === 'true')
  ) {
    setActive(nameOnlyToggle, includeNameOnly);
    applyFilter();
  }
}

export function initPeopleFiltersPage(): void {
  initPeopleFilters();
  document.addEventListener('astro:page-load', initPeopleFilters);
}

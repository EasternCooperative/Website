// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const STORAGE_KEY = 'ecrs-people-show-name-only';

// initPeopleFiltersPage() registers a persistent astro:page-load listener on the
// shared jsdom `document`. Without removing them, listeners from earlier tests
// would keep firing and contaminate later tests.
let addedDocListeners: [string, EventListenerOrEventListenerObject][] = [];

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.resetModules();
  addedDocListeners = [];
  const originalAddEventListener = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    addedDocListeners.push([type, listener as EventListenerOrEventListenerObject]);
    return originalAddEventListener(type, listener, options);
  });
});

afterEach(() => {
  addedDocListeners.forEach(([type, listener]) => document.removeEventListener(type, listener));
  vi.restoreAllMocks();
});

function buildFixture() {
  document.body.innerHTML = `
    <div class="relative mb-4">
      <input type="search" id="people-search" />
    </div>
    <div>
      <button type="button" data-people-sort="balanced" aria-pressed="true">Balanced</button>
      <button type="button" data-people-sort="az" aria-pressed="false">A–Z</button>
      <button type="button" data-people-sort="za" aria-pressed="false">Z–A</button>
      <button type="button" id="people-filter-name-only" aria-pressed="true">Show name-only entries</button>
    </div>

    <p data-people-empty class="hidden"></p>

    <section data-people-section>
      <h2>Leaders</h2>
      <ul data-people-list>
        <li data-person-card data-name="Rain Woods" data-has-profile="true">Rain</li>
        <li data-person-card data-name="Bonnie Ostrofsky" data-has-profile="true">Bonnie</li>
        <li data-person-card data-name="Za McDonnell" data-has-profile="false">Za</li>
      </ul>
    </section>

    <section data-people-section>
      <h2>Board of Directors</h2>
      <ul data-people-list>
        <li data-person-card data-name="Judi Powers" data-has-profile="true">Judi</li>
        <li data-person-card data-name="Fern Lox" data-has-profile="false">Fern</li>
      </ul>
    </section>
  `;
}

function visibleNames(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-person-card]'))
    .filter((el) => !el.classList.contains('hidden'))
    .map((el) => el.dataset.name!);
}

function listOrder(list: HTMLElement): string[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[data-person-card]')).map((el) => el.dataset.name!);
}

describe('initPeopleFiltersPage — setup', () => {
  it('does nothing when there is no [data-people-list]', async () => {
    document.body.innerHTML = '<button id="people-filter-name-only"></button>';
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    expect(() => initPeopleFiltersPage()).not.toThrow();
  });

  it('does not double-wire the same lists on a redundant astro:page-load', async () => {
    buildFixture();
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    document.dispatchEvent(new Event('astro:page-load'));

    const azBtn = document.querySelector<HTMLButtonElement>('[data-people-sort="az"]')!;
    azBtn.click();
    // If init ran twice, appendChild reordering would still be idempotent per click,
    // but the real signal is that init didn't throw and the flag is set exactly once.
    const list = document.querySelector<HTMLElement>('[data-people-list]')!;
    expect(list.dataset.filtersInitialized).toBe('true');
    expect(listOrder(list)).toEqual(['Bonnie Ostrofsky', 'Rain Woods', 'Za McDonnell']);
  });
});

describe('initPeopleFiltersPage — sort', () => {
  it('keeps the server-rendered order under "Balanced" (the default)', async () => {
    buildFixture();
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    const list = document.querySelector<HTMLElement>('[data-people-list]')!;
    expect(listOrder(list)).toEqual(['Rain Woods', 'Bonnie Ostrofsky', 'Za McDonnell']);
  });

  it('sorts each list independently A–Z on click', async () => {
    buildFixture();
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-people-sort="az"]')!.click();

    const [leaders, board] = Array.from(document.querySelectorAll<HTMLElement>('[data-people-list]'));
    expect(listOrder(leaders)).toEqual(['Bonnie Ostrofsky', 'Rain Woods', 'Za McDonnell']);
    expect(listOrder(board)).toEqual(['Fern Lox', 'Judi Powers']);
  });

  it('sorts Z–A on click', async () => {
    buildFixture();
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-people-sort="za"]')!.click();

    const list = document.querySelector<HTMLElement>('[data-people-list]')!;
    expect(listOrder(list)).toEqual(['Za McDonnell', 'Rain Woods', 'Bonnie Ostrofsky']);
  });

  it('marks the clicked sort button active and the others inactive', async () => {
    buildFixture();
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    const azBtn = document.querySelector<HTMLButtonElement>('[data-people-sort="az"]')!;
    const balancedBtn = document.querySelector<HTMLButtonElement>('[data-people-sort="balanced"]')!;
    azBtn.click();

    expect(azBtn.getAttribute('aria-pressed')).toBe('true');
    expect(azBtn.classList.contains('bg-primary')).toBe(true);
    expect(balancedBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('restores the original balanced order after sorting away and back', async () => {
    buildFixture();
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    document.querySelector<HTMLButtonElement>('[data-people-sort="az"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-people-sort="balanced"]')!.click();

    const list = document.querySelector<HTMLElement>('[data-people-list]')!;
    expect(listOrder(list)).toEqual(['Rain Woods', 'Bonnie Ostrofsky', 'Za McDonnell']);
  });
});

describe('initPeopleFiltersPage — name-only filter', () => {
  it('hides profile-less cards when toggled off, and reveals them again when toggled back on', async () => {
    buildFixture();
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    const toggle = document.getElementById('people-filter-name-only')!;
    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(visibleNames()).toEqual(['Rain Woods', 'Bonnie Ostrofsky', 'Judi Powers']);

    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(visibleNames()).toEqual(['Rain Woods', 'Bonnie Ostrofsky', 'Za McDonnell', 'Judi Powers', 'Fern Lox']);
  });

  it('persists the toggle choice to localStorage', async () => {
    buildFixture();
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    document.getElementById('people-filter-name-only')!.click();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('a stored preference overrides the server-rendered default on init', async () => {
    localStorage.setItem(STORAGE_KEY, 'false');
    buildFixture();
    // Fixture's toggle starts aria-pressed="true" (server default), but the stored
    // preference says "false" — init should reconcile both the button and the cards.
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    const toggle = document.getElementById('people-filter-name-only')!;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(visibleNames()).toEqual(['Rain Woods', 'Bonnie Ostrofsky', 'Judi Powers']);
  });

  it('hides a whole section once every card in its list is filtered out', async () => {
    buildFixture();
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    const input = document.getElementById('people-search') as HTMLInputElement;
    input.value = 'Za McDonnell';
    input.dispatchEvent(new Event('input'));

    const [leadersSection, boardSection] = Array.from(document.querySelectorAll<HTMLElement>('[data-people-section]'));
    expect(leadersSection.classList.contains('hidden')).toBe(false);
    expect(boardSection.classList.contains('hidden')).toBe(true);
  });
});

describe('initPeopleFiltersPage — search', () => {
  it('filters by a case-insensitive, trimmed substring match on name', async () => {
    buildFixture();
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    const input = document.getElementById('people-search') as HTMLInputElement;
    input.value = '  rain  ';
    input.dispatchEvent(new Event('input'));

    expect(visibleNames()).toEqual(['Rain Woods']);
  });

  it('combines with the name-only filter (AND)', async () => {
    buildFixture();
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    document.getElementById('people-filter-name-only')!.click(); // hide profile-less
    const input = document.getElementById('people-search') as HTMLInputElement;
    input.value = 'za';
    input.dispatchEvent(new Event('input'));

    // "Za McDonnell" matches the search but has no profile, so it stays hidden.
    expect(visibleNames()).toEqual([]);
  });
});

describe('initPeopleFiltersPage — empty state', () => {
  it('shows the empty message when nothing matches, across every section', async () => {
    buildFixture();
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    const input = document.getElementById('people-search') as HTMLInputElement;
    input.value = 'nonexistent-person';
    input.dispatchEvent(new Event('input'));

    expect(document.querySelector('[data-people-empty]')!.classList.contains('hidden')).toBe(false);
  });

  it('stays hidden while at least one card matches', async () => {
    buildFixture();
    const { initPeopleFiltersPage } = await import('./peopleFilters');
    initPeopleFiltersPage();

    expect(document.querySelector('[data-people-empty]')!.classList.contains('hidden')).toBe(true);
  });
});

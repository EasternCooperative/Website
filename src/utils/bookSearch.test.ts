// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BOOK_FILTER,
  initBookSearch,
  renderBookHits,
  resetBookSearchForTests,
  titleCase,
  toBookHits,
  type Pagefind,
  type PagefindResultData,
} from './bookSearch';

const games: PagefindResultData = {
  url: '/of-play-and-playfulness/games.html',
  excerpt: 'a <mark>balloon</mark> game',
  meta: { title: 'Games' },
  sub_results: [
    { title: 'Games', url: '/of-play-and-playfulness/games.html', excerpt: 'top of page' },
    {
      title: 'BAT THE BALLOON',
      url: '/of-play-and-playfulness/games.html#bat_the_balloon',
      excerpt: 'bat a <mark>balloon</mark>',
    },
  ],
};
const intro: PagefindResultData = {
  url: '/of-play-and-playfulness/introduction.html',
  excerpt: 'a <mark>balloon</mark> once',
  meta: {},
};

describe('toBookHits', () => {
  it("names a section as the book's contents does, when it lists it", () => {
    const [hit] = toBookHits([games], { 'games#bat_the_balloon': 'Bat the Balloon (Seated)' });
    expect(hit.sections[0].title).toBe('Bat the Balloon (Seated)');
  });

  it('keeps the chapter excerpt and the anchored sections, with site-style URLs', () => {
    expect(toBookHits([games, intro])).toEqual([
      {
        title: 'Games',
        url: '/of-play-and-playfulness/games',
        excerpt: 'a <mark>balloon</mark> game',
        sections: [
          {
            title: 'Bat the Balloon',
            url: '/of-play-and-playfulness/games#bat_the_balloon',
            excerpt: 'bat a <mark>balloon</mark>',
          },
        ],
      },
      { title: '', url: '/of-play-and-playfulness/introduction', excerpt: 'a <mark>balloon</mark> once', sections: [] },
    ]);
  });
});

describe('titleCase', () => {
  it('title-cases capitals and leaves mixed case alone', () => {
    expect(titleCase('PROGRAMS FOR SPECIAL POPULATIONS')).toBe('Programs for Special Populations');
    expect(titleCase('THE THIEF')).toBe('The Thief');
    expect(titleCase('WARM-UPS (FOR DANCING)')).toBe('Warm-Ups (For Dancing)');
    expect(titleCase('Bat the Balloon')).toBe('Bat the Balloon');
  });
});

describe('renderBookHits', () => {
  it('links sections when there are some, the chapter excerpt otherwise, and escapes titles', () => {
    const html = renderBookHits(toBookHits([games, { ...intro, meta: { title: 'Intro <b>' } }]));
    expect(html).toContain(
      '<a href="/of-play-and-playfulness/games#bat_the_balloon"><span class="opp-search-section">Bat the Balloon</span>'
    );
    expect(html).toContain('<span class="opp-search-excerpt">bat a <mark>balloon</mark></span>');
    expect(html).toContain('>Intro &lt;b&gt;</a><p class="opp-search-excerpt">a <mark>balloon</mark> once</p>');
  });
});

describe('initBookSearch', () => {
  const page = `
    <button data-opp-search-open><span>Search the book</span></button>
    <dialog id="opp-search">
      <button data-opp-search-close>Close</button>
      <input id="opp-search-input" />
      <p id="opp-search-status"></p>
      <ul id="opp-search-results"></ul>
    </dialog>
    <input id="other" />`;

  const pagefindWith = (results: PagefindResultData[] | null): Pagefind => ({
    search: vi.fn(async () => (results ? { results: results.map((r) => ({ data: async () => r })) } : null)),
  });

  const type = async (value: string) => {
    const input = document.getElementById('opp-search-input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(250);
  };
  const $ = (id: string) => document.getElementById(id)!;

  beforeEach(() => {
    vi.useFakeTimers();
    resetBookSearchForTests();
    document.body.innerHTML = page;
    // jsdom has no modal dialogs.
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  });
  afterEach(() => vi.useRealTimers());

  it('opens on the button, searches only the book, and shows the matches', async () => {
    const pagefind = pagefindWith([games]);
    const load = vi.fn(async () => pagefind);
    initBookSearch(load);
    initBookSearch(load); // listeners are added once

    (document.querySelector('[data-opp-search-open] span') as HTMLElement).click();
    expect(($('opp-search') as HTMLDialogElement).open).toBe(true);
    expect(document.activeElement).toBe($('opp-search-input'));

    await type('balloon');
    expect(pagefind.search).toHaveBeenCalledWith('balloon', { filters: { book: BOOK_FILTER } });
    expect($('opp-search-status').textContent).toBe('1 chapter mentions "balloon".');
    expect($('opp-search-results').innerHTML).toContain('#bat_the_balloon');
    expect($('opp-search-results').innerHTML).toContain('>Bat the Balloon<');

    $('opp-search').dataset.labels = JSON.stringify({ 'games#bat_the_balloon': 'Balloon Batting' });
    await type('balloons');
    expect($('opp-search-results').innerHTML).toContain('>Balloon Batting<');

    await type('balloon game');
    expect(load).toHaveBeenCalledTimes(1);

    // Following a result closes the dialog, even when it's on this page.
    (document.querySelector('#opp-search-results a') as HTMLElement).click();
    expect(($('opp-search') as HTMLDialogElement).open).toBe(false);
  });

  it('counts chapters, reports no matches, and clears on an empty box', async () => {
    initBookSearch(async () => pagefindWith([games, intro]));
    await type('balloon');
    expect($('opp-search-status').textContent).toBe('2 chapters mention "balloon".');

    resetBookSearchForTests();
    document.body.innerHTML = page;
    initBookSearch(async () => pagefindWith(null));
    await type('zzz ');
    expect($('opp-search-status').textContent).toBe('Nothing in the book matches "zzz".');

    await type('  ');
    expect($('opp-search-status').textContent).toBe('');
    expect($('opp-search-results').innerHTML).toBe('');
  });

  it('shows only the newest search when an older one finishes last', async () => {
    let releaseFirst!: () => void;
    const pagefind: Pagefind = {
      search: vi.fn(async (term: string) => {
        if (term === 'slow') await new Promise<void>((r) => (releaseFirst = r));
        return { results: [{ data: async () => (term === 'slow' ? intro : games) }] };
      }),
    };
    initBookSearch(async () => pagefind);
    await type('slow');
    await type('fast');
    releaseFirst();
    await vi.runAllTimersAsync();
    expect($('opp-search-results').innerHTML).toContain('games');
    expect($('opp-search-results').innerHTML).not.toContain('introduction');
  });

  it('says so when the index cannot load, and tries again next time', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('no index'))
      .mockResolvedValue(pagefindWith([games]));
    initBookSearch(load);
    await type('balloon');
    expect($('opp-search-status').textContent).toBe('Search is not available right now.');
    await type('balloons');
    expect($('opp-search-status').textContent).toBe('1 chapter mentions "balloons".');
  });

  it('drops a failed search that a newer one replaced', async () => {
    let failFirst!: () => void;
    const pagefind: Pagefind = {
      search: vi.fn(async (term: string) => {
        if (term === 'slow') await new Promise<void>((_, reject) => (failFirst = () => reject(new Error('x'))));
        return { results: [{ data: async () => games }] };
      }),
    };
    initBookSearch(async () => pagefind);
    await type('slow');
    await type('fast');
    failFirst();
    await vi.runAllTimersAsync();
    expect($('opp-search-status').textContent).toBe('1 chapter mentions "fast".');
  });

  it('closes on the close button and the backdrop, and ignores other clicks and inputs', async () => {
    const load = vi.fn(async () => pagefindWith([games]));
    initBookSearch(load);
    const dialog = $('opp-search') as HTMLDialogElement;

    (document.querySelector('[data-opp-search-open]') as HTMLElement).click();
    $('opp-search-status').click(); // inside the dialog, not a control
    expect(dialog.open).toBe(true);
    (document.querySelector('[data-opp-search-close]') as HTMLElement).click();
    expect(dialog.open).toBe(false);

    (document.querySelector('[data-opp-search-open]') as HTMLElement).click();
    dialog.click(); // the backdrop
    expect(dialog.open).toBe(false);

    document.dispatchEvent(new MouseEvent('click'));
    ($('other') as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
    document.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(250);
    expect(load).not.toHaveBeenCalled();
  });

  it('loads the built index by default, which tests and `astro dev` do not have', async () => {
    initBookSearch();
    await type('balloon');
    await vi.waitFor(() => expect($('opp-search-status').textContent).toBe('Search is not available right now.'));
  });

  it('does nothing on a page without the search', async () => {
    document.body.innerHTML = '<button data-opp-search-open>Search</button><input id="opp-search-input" />';
    const load = vi.fn(async () => pagefindWith([games]));
    initBookSearch(load);
    (document.querySelector('button') as HTMLElement).click();
    await type('balloon');
    expect(load).not.toHaveBeenCalled();
  });
});

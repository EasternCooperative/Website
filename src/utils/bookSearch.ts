/**
 * Of Play and Playfulness: search within the book. Uses the site's Pagefind
 * index, filtered to pages tagged `data-pagefind-filter="book:..."` (the
 * chapters), and shows each matching chapter with the sections (games, dances,
 * songs) where the words appear, linked straight to them.
 *
 * Listeners sit on the document, so the search keeps working after
 * view-transition navigation swaps the page out (page scripts don't re-run).
 */
import { normalizeResultPath } from '~/utils/searchUrlFix';

export const BOOK_FILTER = 'Of Play and Playfulness';
const MAX_CHAPTERS = 10;
const MAX_SECTIONS = 4;
const DEBOUNCE_MS = 200;

interface PagefindSubResult {
  title: string;
  url: string;
  excerpt: string;
}
export interface PagefindResultData {
  url: string;
  excerpt: string;
  meta: { title?: string };
  sub_results?: PagefindSubResult[];
}
export interface Pagefind {
  search: (
    term: string,
    options: { filters: Record<string, string> }
  ) => Promise<{ results: { data: () => Promise<PagefindResultData> }[] } | null>;
}

export interface BookHit {
  title: string;
  url: string;
  excerpt: string;
  sections: { title: string; url: string; excerpt: string }[];
}

/** The book's contents labels, keyed "<chapter slug>#<anchor>" ("games#wink": "Wink"). */
export type SectionLabels = Record<string, string>;

/**
 * One hit per chapter: its excerpt, plus the sections (anchored sub-results)
 * that match, named as the book's contents names them when it lists them.
 */
export function toBookHits(results: PagefindResultData[], labels: SectionLabels = {}): BookHit[] {
  return results.map((r) => {
    const anchored = (r.sub_results ?? []).filter((s) => s.url.includes('#'));
    return {
      title: r.meta.title ?? '',
      url: normalizeResultPath(r.url),
      excerpt: r.excerpt,
      sections: anchored.slice(0, MAX_SECTIONS).map((s) => {
        const [path, anchor] = s.url.split('#');
        const url = `${normalizeResultPath(path)}#${anchor}`;
        const slug = url.slice(url.lastIndexOf('/') + 1);
        return { title: labels[slug] ?? titleCase(s.title), url, excerpt: s.excerpt };
      }),
    };
  });
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const MINOR_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/** The book's headings are in capitals; show them in title case (small words lower, except first). */
export function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(' ')
    .map((word, i) =>
      i > 0 && MINOR_WORDS.has(word) ? word : word.replace(/(^|[(-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
    )
    .join(' ');
}

/** Excerpts come from Pagefind already escaped, with matches in <mark>. */
export function renderBookHits(hits: BookHit[]): string {
  return hits
    .map(
      (h) =>
        `<li class="opp-search-hit">` +
        `<a href="${escapeHtml(h.url)}" class="opp-search-chapter">${escapeHtml(h.title)}</a>` +
        (h.sections.length
          ? `<ul>${h.sections
              .map(
                (s) =>
                  `<li><a href="${escapeHtml(s.url)}"><span class="opp-search-section">${escapeHtml(s.title)}</span>` +
                  `<span class="opp-search-excerpt">${s.excerpt}</span></a></li>`
              )
              .join('')}</ul>`
          : `<p class="opp-search-excerpt">${h.excerpt}</p>`) +
        `</li>`
    )
    .join('');
}

const loadDefault = (): Promise<Pagefind> => {
  // Built into dist/ by the Pagefind integration, so it can't be bundled.
  const path = '/pagefind/pagefind.js';
  return import(/* @vite-ignore */ path) as Promise<Pagefind>;
};

let initialized = false;

/**
 * Wire up the dialog (#opp-search) and every `[data-opp-search-open]` button.
 * `load` is swappable for tests.
 */
export function initBookSearch(load: () => Promise<Pagefind> = loadDefault): void {
  if (initialized) return;
  initialized = true;
  let pagefind: Promise<Pagefind> | undefined;
  let latest = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const parts = () => ({
    dialog: document.getElementById('opp-search') as HTMLDialogElement | null,
    input: document.getElementById('opp-search-input') as HTMLInputElement | null,
    results: document.getElementById('opp-search-results'),
    status: document.getElementById('opp-search-status'),
  });

  async function run(term: string): Promise<void> {
    const { dialog, results, status } = parts();
    if (!dialog || !results || !status) return;
    const id = ++latest;
    if (!term.trim()) {
      results.innerHTML = '';
      status.textContent = '';
      return;
    }
    try {
      pagefind ??= load();
      const found = await (await pagefind).search(term, { filters: { book: BOOK_FILTER } });
      const data = await Promise.all((found?.results ?? []).slice(0, MAX_CHAPTERS).map((r) => r.data()));
      if (id !== latest) return; // a newer search has started
      const labels = JSON.parse(dialog.dataset.labels ?? '{}') as SectionLabels;
      results.innerHTML = renderBookHits(toBookHits(data, labels));
      status.textContent = data.length
        ? `${data.length === 1 ? '1 chapter mentions' : `${data.length} chapters mention`} "${term.trim()}".`
        : `Nothing in the book matches "${term.trim()}".`;
    } catch {
      pagefind = undefined;
      if (id !== latest) return;
      results.innerHTML = '';
      status.textContent = 'Search is not available right now.';
    }
  }

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const { dialog, input } = parts();
    if (!dialog || !input) return;
    if (event.target.closest('[data-opp-search-open]')) {
      dialog.showModal();
      input.focus();
      input.select();
    } else if (event.target === dialog || event.target.closest('[data-opp-search-close], #opp-search-results a')) {
      // The backdrop, the close button, or a result (which may be on this page).
      dialog.close();
    }
  });

  document.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.id !== 'opp-search-input') return;
    const term = event.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => void run(term), DEBOUNCE_MS);
  });
}

/** For tests: forget that the listeners were added. */
export function resetBookSearchForTests(): void {
  initialized = false;
}

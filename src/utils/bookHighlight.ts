/**
 * Of Play and Playfulness: highlight the words a reader searched for. Book
 * search results link with `?highlight=<words>` (see bookSearch.ts), and the
 * chapter page marks each word in the text that starts with one of them, so
 * "balloon" also finds "Balloons". All in the browser: the site is static.
 */
export const HIGHLIGHT_PARAM = 'highlight';
const ROOT = '.opp-book';
const MIN_WORD = 2;

/** Add the search words to a result link, before any #anchor. */
export function withHighlight(url: string, term: string): string {
  const words = term.trim();
  if (!words) return url;
  const [path, anchor] = url.split('#');
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}${HIGHLIGHT_PARAM}=${encodeURIComponent(words)}${anchor ? `#${anchor}` : ''}`;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A pattern for words starting with any of the search words, or null when there are none. */
export function termPattern(term: string): RegExp | null {
  const words = [...new Set(term.toLowerCase().split(/\s+/))].filter((w) => w.length >= MIN_WORD);
  if (!words.length) return null;
  // Longest first, so "balloons" isn't cut short by "ball".
  words.sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escapeRegExp).join('|')})[\\p{L}\\p{N}'’-]*`, 'giu');
}

/** Wrap each match inside `root` in <mark class="opp-hit">. Returns the marks, in page order. */
export function highlightTerms(root: Element, term: string): HTMLElement[] {
  const pattern = termPattern(term);
  if (!pattern) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement!.closest('script, style, mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  const marks: HTMLElement[] = [];
  for (const node of nodes) {
    const text = node.data;
    const matches = [...text.matchAll(pattern)];
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let at = 0;
    for (const m of matches) {
      fragment.append(text.slice(at, m.index));
      const mark = document.createElement('mark');
      mark.className = 'opp-hit';
      mark.textContent = m[0];
      fragment.append(mark);
      marks.push(mark);
      at = m.index + m[0].length;
    }
    fragment.append(text.slice(at));
    node.replaceWith(fragment);
  }
  return marks;
}

/** Undo highlightTerms. */
export function clearHighlights(root: ParentNode = document): void {
  root.querySelectorAll('mark.opp-hit').forEach((mark) => {
    const parent = mark.parentNode!;
    mark.replaceWith(...mark.childNodes);
    parent.normalize();
  });
}

/** The words from the page URL, or '' when it has none. */
export const highlightFromUrl = (search: string): string =>
  (new URLSearchParams(search).get(HIGHLIGHT_PARAM) ?? '').trim();

/**
 * Highlight the URL's words in the chapter text, scroll to the first when the
 * link has no #anchor of its own, and show a bar to clear them (which also
 * drops the words from the URL).
 */
export function applyHighlightFromUrl(): void {
  document.getElementById('opp-hit-bar')?.remove();
  const term = highlightFromUrl(location.search);
  const root = document.querySelector(ROOT);
  if (!term || !root) return;
  const marks = highlightTerms(root, term);
  if (!marks.length) return;
  if (!location.hash) marks[0].scrollIntoView({ block: 'center' });

  const bar = document.createElement('div');
  bar.id = 'opp-hit-bar';
  bar.className = 'opp-hit-bar no-print';
  bar.setAttribute('role', 'status');
  const label = document.createElement('span');
  label.textContent = `${marks.length} ${marks.length === 1 ? 'match' : 'matches'} for "${term}"`;
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear highlights';
  clear.addEventListener('click', () => {
    clearHighlights(root);
    bar.remove();
    const url = new URL(location.href);
    url.searchParams.delete(HIGHLIGHT_PARAM);
    history.replaceState(history.state, '', url);
  });
  bar.append(label, clear);
  document.body.append(bar);
  // The browser already scrolled to the #anchor; scroll again now that the bar
  // is in the way, so the section's heading lands below it (see the CSS).
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
}

let initialized = false;

/** Highlight on every page load, including after view-transition navigation. */
export function initBookHighlight(): void {
  if (initialized) return;
  initialized = true;
  document.addEventListener('astro:page-load', applyHighlightFromUrl);
}

/** For tests: forget that the listener was added. */
export function resetBookHighlightForTests(): void {
  initialized = false;
}

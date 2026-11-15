import chaptersData from '~/data/of-play-and-playfulness/chapters.json';

/**
 * Of Play and Playfulness, ECRS's 1990 book, restored from the archived
 * ecrs.org/ofplayandplayfulness/ pages. Each chapter's text is an HTML
 * fragment converted from the archived page; chapters.json is the book's own
 * table of contents.
 */
export interface Chapter {
  slug: string;
  /** File name on the old site, kept for the redirect list in public/_redirects. */
  legacyFile: string;
  title: string;
  titleImage: string;
  titleImageWidth: number;
  titleImageHeight: number;
  quote: string | null;
  attribution: string | null;
  sections: { id: string; label: string }[];
}

export const BOOK_PATH = '/of-play-and-playfulness';
export const BOOK_IMAGE_PATH = '/images/of-play-and-playfulness';
/** The whole book as one PDF, rendered from BOOK_PRINT_PATH by scripts/render-book-pdf.mjs. */
export const BOOK_PDF_PATH = '/docs/of-play-and-playfulness.pdf';
export const BOOK_PRINT_PATH = `${BOOK_PATH}/print`;

export const chapters: Chapter[] = chaptersData;

const fragments = import.meta.glob<string>('../data/of-play-and-playfulness/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export function chapterHtml(slug: string): string {
  const html = fragments[`../data/of-play-and-playfulness/${slug}.html`];
  if (html === undefined) throw new Error(`No text for chapter "${slug}"`);
  return html;
}

export const chapterPath = (slug: string): string => `${BOOK_PATH}/${slug}`;

/** The chapter's hand-lettered title, as drawn for the 1990 book. */
export const titleImagePath = (chapter: Chapter): string => `${BOOK_IMAGE_PATH}/${chapter.titleImage}`;

/** A to Z groups for an index already in order; anything not starting with a letter goes under "#". */
export function groupByInitial<T extends { label: string }>(entries: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const initial = /^[a-z]/i.test(entry.label) ? entry.label[0].toUpperCase() : '#';
    groups.set(initial, [...(groups.get(initial) ?? []), entry]);
  }
  return [...groups];
}

const IMG_SRC = /(<img\b[^>]*?\bsrc=")([^"]+)(")/g;

/**
 * Point every <img> in a chapter's HTML at the URL `optimize` returns for its
 * src. The chapter page passes the Sharp pipeline (findImage + getImage), so
 * images inside the archived text are optimized like any other on the site.
 * Each distinct src is optimized once.
 */
export async function rewriteImageSources(html: string, optimize: (src: string) => Promise<string>): Promise<string> {
  const sources = [...new Set(Array.from(html.matchAll(IMG_SRC), (m) => m[2]))];
  const urls = new Map(await Promise.all(sources.map(async (src) => [src, await optimize(src)] as const)));
  // Every src the pattern can match was collected above, so the lookup always hits.
  return html.replace(IMG_SRC, (_, before: string, src: string, after: string) => before + urls.get(src)! + after);
}

/**
 * The book flags each contribution with a tiny mark (see its Introduction): a
 * lettered P for personal experience, an L for theory and leadership, and a
 * flower for an excerpt from an earlier publication. At 16px the 1990 scans don't
 * read, so each becomes a labeled tag with an icon (Tabler's message-heart,
 * bulb, and book-2) that says what it means.
 */
const MARKS: Record<string, { kind: string; label: string; icon: string }> = {
  'personal.jpg': {
    kind: 'personal',
    label: 'Personal experience',
    icon: '<path d="M8 9h8m-8 4h3.5m-1.02 6.512L8 21v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4"/><path d="m18 22l3.35-3.284a2.143 2.143 0 0 0 .005-3.071a2.24 2.24 0 0 0-3.129-.006l-.224.22l-.223-.22a2.24 2.24 0 0 0-3.128-.006a2.143 2.143 0 0 0-.006 3.071z"/>',
  },
  'leadership.jpg': {
    kind: 'theory',
    label: 'Theory and leadership',
    icon: '<path d="M3 12h1m8-9v1m8 8h1M5.6 5.6l.7.7m12.1-.7l-.7.7M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0-1 3a2 2 0 0 1-4 0a3.5 3.5 0 0 0-1-3m.7 1h4.6"/>',
  },
  'flower.jpg': {
    kind: 'excerpt',
    label: 'Excerpt',
    icon: '<path d="M19 4v16H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M19 16H7a2 2 0 0 0-2 2M9 8h6"/>',
  },
};

const MARK_IMG = /<img\b[^>]*\bclass="opp-mark"[^>]*>/g;

const PARAGRAPH_START = /<p\b[^>]*>\s*$/;

/** A mark that opens a paragraph is tagged `opp-tag-lead`, so it can sit on its own line above the text. */
export function replaceMarks(html: string): string {
  return html.replace(MARK_IMG, (tag, offset: number) => {
    const file = /\bsrc="[^"]*\/([^"/]+)"/.exec(tag)?.[1] ?? '';
    const mark = MARKS[file];
    if (!mark) throw new Error(`Unknown book mark: ${tag}`);
    const lead = PARAGRAPH_START.test(html.slice(Math.max(0, offset - 200), offset)) ? ' opp-tag-lead' : '';
    return (
      `<span class="opp-tag opp-tag-${mark.kind}${lead}">` +
      `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${mark.icon}</svg>` +
      `${mark.label}</span>`
    );
  });
}

/**
 * For the one-document print edition: every chapter shares a page, so ids are
 * prefixed with the chapter slug, and links to a chapter (or a place in one)
 * become links within the document.
 */
export function anchorId(slug: string, id?: string): string {
  return id ? `${slug}--${id}` : slug;
}

export function localizeAnchors(html: string, slug: string): string {
  const bookLink = new RegExp(`href="${BOOK_PATH}/([a-z0-9-]+)(?:#([^"]+))?"`, 'g');
  return html
    .replace(/\bid="([^"]+)"/g, (_, id: string) => `id="${anchorId(slug, id)}"`)
    .replace(/href="#([^"]+)"/g, (_, id: string) => `href="#${anchorId(slug, id)}"`)
    .replace(bookLink, (_, target: string, id?: string) => `href="#${anchorId(target, id)}"`);
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Turn each mention of a current leader (by full name) into the same trigger
 * the schedule uses, which opens their card on hover or tap (initLeaderPopovers).
 * Only text is touched, never tags or attributes. Returns the ids mentioned, so
 * the page renders one card for each. The print edition skips this: a PDF gets
 * the plain name.
 */
export function linkLeaders(html: string, leaders: { id: string; name: string }[]): { html: string; ids: string[] } {
  const ids = new Set<string>();
  // Longest names first, so "Mary Ann Smith" wins over "Ann Smith".
  const sorted = [...leaders].filter((l) => l.name.trim()).sort((a, b) => b.name.length - a.name.length);
  if (!sorted.length) return { html, ids: [] };
  const byName = new Map(sorted.map((l) => [l.name, l.id]));
  const pattern = new RegExp(`\\b(${sorted.map((l) => escapeRegExp(l.name)).join('|')})\\b`, 'g');
  const out = html
    .split(/(<[^>]*>)/)
    .map((part) =>
      part.startsWith('<')
        ? part
        : part.replace(pattern, (name: string) => {
            const id = byName.get(name)!;
            ids.add(id);
            return (
              `<span role="button" tabindex="0" data-popover-target="leader-${id}" aria-controls="leader-${id}" ` +
              `aria-expanded="false" class="opp-person">${name}</span>`
            );
          })
    )
    .join('');
  return { html: out, ids: [...ids] };
}

/**
 * The site's HTML minifier drops the whitespace between block tags, so
 * "<dt>Calls:</dt><dd>When</dd>" reaches Pagefind as "Calls:When" and the
 * words can't be found on their own. An encoded space at the end of each list
 * term, definition, list item, and table cell survives minifying, isn't drawn
 * (it's trailing), and keeps the words apart in the search index.
 */
export function separateBlocks(html: string): string {
  return html.replace(/<\/(dt|dd|li|td)>/g, '&#32;</$1>');
}

/** In the print edition each chapter is an h2, so its sections step down to h3 (and the PDF's bookmarks nest). */
export function demoteHeadings(html: string): string {
  return html.replace(/<(\/?)h2\b/g, '<$1h3');
}

/** Every section across the book, A to Z, for the contents page's index. */
export function activityIndex(): { label: string; href: string; chapter: string }[] {
  return chapters
    .flatMap((ch) =>
      ch.sections.map((s) => ({ label: s.label, href: `${chapterPath(ch.slug)}#${s.id}`, chapter: ch.title }))
    )
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}

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
  return html.replace(
    IMG_SRC,
    (_, before: string, src: string, after: string) => before + (urls.get(src) ?? src) + after
  );
}

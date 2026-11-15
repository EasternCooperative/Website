import { describe, it, expect, vi } from 'vitest';
import {
  activityIndex,
  anchorId,
  chapterHtml,
  chapterPath,
  chapters,
  demoteHeadings,
  groupByInitial,
  linkLeaders,
  localizeAnchors,
  titleImagePath,
  replaceMarks,
  rewriteImageSources,
} from './ofPlayAndPlayfulness';

describe('chapters', () => {
  it('has a text fragment for every chapter in the contents', () => {
    expect(chapters).toHaveLength(19);
    for (const ch of chapters) expect(chapterHtml(ch.slug).length).toBeGreaterThan(0);
  });

  it('builds chapter URLs under the book path', () => {
    expect(chapterPath('games')).toBe('/of-play-and-playfulness/games');
  });

  it('throws for a chapter that does not exist', () => {
    expect(() => chapterHtml('no-such-chapter')).toThrow('no-such-chapter');
  });

  it('links every contents entry to an anchor in its chapter', () => {
    for (const ch of chapters) {
      const html = chapterHtml(ch.slug);
      for (const s of ch.sections) expect(html, `${ch.slug}#${s.id}`).toContain(`id="${s.id}"`);
    }
  });
});

describe('chapter text', () => {
  it('uses each id once per chapter, so anchors land where they should', () => {
    for (const ch of chapters) {
      const ids = Array.from(chapterHtml(ch.slug).matchAll(/\bid="([^"]+)"/g), (m) => m[1]);
      expect(new Set(ids).size, ch.slug).toBe(ids.length);
    }
  });
});

describe('replaceMarks', () => {
  const mark = (file: string) =>
    `<img alt="x" class="opp-mark" height="14" src="/images/of-play-and-playfulness/${file}" title="x" width="17"/>`;

  it('turns each mark into a labeled tag', () => {
    const out = replaceMarks(`<p>${mark('personal.jpg')} We lived with the Moyers.</p>`);
    expect(out).toMatch(
      /^<p><span class="opp-tag opp-tag-personal opp-tag-lead"><svg aria-hidden="true"[^>]*>.*<\/svg>Personal experience<\/span> We lived/
    );
    expect(replaceMarks(mark('leadership.jpg'))).toContain('Theory and leadership</span>');
    expect(replaceMarks(mark('flower.jpg'))).toContain('opp-tag-excerpt');
  });

  it('marks a tag that opens a paragraph as the lead, and not one inside a sentence', () => {
    expect(replaceMarks(`<blockquote><p> ${mark('personal.jpg')} Text</p></blockquote>`)).toContain(
      'opp-tag-personal opp-tag-lead'
    );
    expect(replaceMarks(`<p>experiences ( ${mark('personal.jpg')} ) to</p>`)).toContain(
      'class="opp-tag opp-tag-personal"'
    );
  });

  it('leaves other images alone and rejects a mark it does not know', () => {
    const figure = '<img class="opp-figure" src="/images/of-play-and-playfulness/personal.jpg"/>';
    expect(replaceMarks(figure)).toBe(figure);
    expect(() => replaceMarks(mark('mystery.jpg'))).toThrow('Unknown book mark');
    expect(() => replaceMarks('<img class="opp-mark" alt="x"/>')).toThrow('Unknown book mark');
  });

  it('replaces every mark in the book', () => {
    for (const ch of chapters) expect(replaceMarks(chapterHtml(ch.slug))).not.toContain('opp-mark');
  });
});

describe('localizeAnchors', () => {
  it('prefixes ids and points book links at places in the same document', () => {
    const html =
      '<h2 id="props">Props</h2><a href="#props">up</a><a href="/of-play-and-playfulness/games">Games</a>' +
      '<a href="/of-play-and-playfulness/games#wink">Wink</a><a href="https://example.org/">out</a>';
    expect(localizeAnchors(html, 'storytelling')).toBe(
      '<h2 id="storytelling--props">Props</h2><a href="#storytelling--props">up</a><a href="#games">Games</a>' +
        '<a href="#games--wink">Wink</a><a href="https://example.org/">out</a>'
    );
  });

  it('builds anchor ids from a chapter slug and an optional id', () => {
    expect(anchorId('games')).toBe('games');
    expect(anchorId('games', 'wink')).toBe('games--wink');
  });
});

describe('linkLeaders', () => {
  const leaders = [
    { id: 'frank-baskin', name: 'Frank Baskin' },
    { id: 'ann-lee', name: 'Ann Lee' },
    { id: 'mary-ann-lee', name: 'Mary Ann Lee' },
  ];

  it('turns a mention into a card trigger and reports who was mentioned', () => {
    const { html, ids } = linkLeaders('<p class="opp-signature">- Frank Baskin</p>', leaders);
    expect(html).toBe(
      '<p class="opp-signature">- <span role="button" tabindex="0" data-popover-target="leader-frank-baskin" ' +
        'aria-controls="leader-frank-baskin" aria-expanded="false" class="opp-person">Frank Baskin</span></p>'
    );
    expect(ids).toEqual(['frank-baskin']);
  });

  it('prefers the longest name, and lists each person once', () => {
    const { html, ids } = linkLeaders('<p>Mary Ann Lee and Ann Lee, then Ann Lee again.</p>', leaders);
    expect(html.match(/data-popover-target="leader-mary-ann-lee"/g)).toHaveLength(1);
    expect(html.match(/data-popover-target="leader-ann-lee"/g)).toHaveLength(2);
    expect(ids).toEqual(['mary-ann-lee', 'ann-lee']);
  });

  it('leaves attributes, partial words, and unknown people alone', () => {
    const html = '<img alt="Frank Baskin"/><p>Frank Baskins and Bob Siftar</p>';
    expect(linkLeaders(html, leaders)).toEqual({ html, ids: [] });
    expect(linkLeaders(html, [])).toEqual({ html, ids: [] });
  });
});

describe('demoteHeadings', () => {
  it('turns section h2s into h3s and leaves other tags alone', () => {
    expect(demoteHeadings('<h2 id="wink">WINK</h2><h20>x</h20><p>h2</p>')).toBe(
      '<h3 id="wink">WINK</h3><h20>x</h20><p>h2</p>'
    );
  });
});

describe('activityIndex', () => {
  it('lists every section A to Z with a link into its chapter', () => {
    const index = activityIndex();
    expect(index).toHaveLength(chapters.reduce((n, ch) => n + ch.sections.length, 0));
    const labels = index.map((e) => e.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    expect(index.find((e) => e.label === 'Wink')).toEqual({
      label: 'Wink',
      href: '/of-play-and-playfulness/games#wink',
      chapter: 'Games',
    });
  });
});

describe('groupByInitial', () => {
  it('groups entries under their first letter, keeping order, with non-letters under #', () => {
    const entries = [{ label: 'A-What' }, { label: 'apple' }, { label: '"Quoted"' }, { label: 'Bingo' }];
    expect(groupByInitial(entries)).toEqual([
      ['A', [{ label: 'A-What' }, { label: 'apple' }]],
      ['#', [{ label: '"Quoted"' }]],
      ['B', [{ label: 'Bingo' }]],
    ]);
  });
});

describe('titleImagePath', () => {
  it('points at the chapter title art', () => {
    expect(titleImagePath(chapters[2])).toBe('/images/of-play-and-playfulness/chapter03.jpg');
  });
});

describe('rewriteImageSources', () => {
  it('replaces each img src with the optimized URL and leaves the rest of the tag alone', async () => {
    const html = '<p><img alt="Shoo Fly" class="opp-music" src="/images/a.jpg" width="323"/> text</p>';
    const out = await rewriteImageSources(html, async (src) => `/_astro${src.replace('.jpg', '.webp')}`);
    expect(out).toBe('<p><img alt="Shoo Fly" class="opp-music" src="/_astro/images/a.webp" width="323"/> text</p>');
  });

  it('optimizes a repeated image once', async () => {
    const optimize = vi.fn(async (src: string) => `${src}?o`);
    const html = '<img src="/images/flower.jpg"/><img src="/images/flower.jpg"/><img src="/images/b.jpg"/>';
    const out = await rewriteImageSources(html, optimize);
    expect(optimize).toHaveBeenCalledTimes(2);
    expect(out).toBe('<img src="/images/flower.jpg?o"/><img src="/images/flower.jpg?o"/><img src="/images/b.jpg?o"/>');
  });

  it('does not touch src attributes on other elements', async () => {
    const html = '<source src="/images/a.jpg"/><img src="/images/a.jpg"/>';
    const out = await rewriteImageSources(html, async () => '/new.webp');
    expect(out).toBe('<source src="/images/a.jpg"/><img src="/new.webp"/>');
  });

  it('returns html with no images unchanged', async () => {
    const optimize = vi.fn(async (src: string) => src);
    expect(await rewriteImageSources('<p>No pictures.</p>', optimize)).toBe('<p>No pictures.</p>');
    expect(optimize).not.toHaveBeenCalled();
  });
});

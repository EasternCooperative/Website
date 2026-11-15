import { describe, it, expect, vi } from 'vitest';
import { chapterHtml, chapters, rewriteImageSources } from './ofPlayAndPlayfulness';

describe('chapters', () => {
  it('has a text fragment for every chapter in the contents', () => {
    expect(chapters).toHaveLength(19);
    for (const ch of chapters) expect(chapterHtml(ch.slug).length).toBeGreaterThan(0);
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

import { describe, it, expect } from 'vitest';
import { escapeHtml, renderMarkdown, renderInlineMarkdown, stripMarkdown } from './markdown';

describe('escapeHtml', () => {
  it('escapes all special characters', () => {
    expect(escapeHtml(`<a href="x">O'Brien & co</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;O&#39;Brien &amp; co&lt;/a&gt;'
    );
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('renderMarkdown', () => {
  it('renders bold and links as HTML', () => {
    const html = renderMarkdown('**bold** and [a link](https://example.com)');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="https://example.com">a link</a>');
  });

  it('turns single newlines into <br> (breaks: true)', () => {
    const html = renderMarkdown('line one\nline two');
    expect(html).toContain('<br>');
  });

  it('neutralizes raw HTML by escaping it before parsing', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderInlineMarkdown', () => {
  it('does not wrap output in a <p> tag', () => {
    const html = renderInlineMarkdown('**bold** text');
    expect(html.trim().startsWith('<p>')).toBe(false);
    expect(html).toContain('<strong>bold</strong>');
  });

  it('escapes raw HTML before parsing', () => {
    const html = renderInlineMarkdown('<b>x</b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

describe('stripMarkdown', () => {
  it('strips bold and italic emphasis', () => {
    expect(stripMarkdown('**bold** and *italic*')).toBe('bold and italic');
  });

  it('strips heading markers', () => {
    expect(stripMarkdown('# Heading\nBody text')).toBe('Heading\nBody text');
  });

  it('strips list bullet markers', () => {
    expect(stripMarkdown('- one\n- two')).toBe('one\ntwo');
  });

  it('replaces links with their label', () => {
    expect(stripMarkdown('See [our site](https://example.com) for more')).toBe('See our site for more');
  });

  it('trims surrounding whitespace', () => {
    expect(stripMarkdown('  plain text  ')).toBe('plain text');
  });
});

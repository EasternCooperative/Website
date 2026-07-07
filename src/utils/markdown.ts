import { marked } from 'marked';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Renders CMS-authored markdown strings (frontmatter fields, not .md bodies).
// Raw HTML is neutralized by escaping <, > and & before parsing — which also
// sacrifices the markdown syntaxes built on those characters (`>` blockquotes,
// `<url>` autolinks), an accepted trade-off for these short CMS fields.
// `breaks: true` so single newlines become hard line breaks — essential for
// lyrics and step lists as editors type them.
export function renderMarkdown(str: string): string {
  const escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return marked.parse(escaped, { breaks: true, async: false });
}

// Same escaping/markdown support as renderMarkdown, but for a string being
// injected into an element that is already a block container the caller
// doesn't control the tag of (a shared widget's `<p>`, a `<blockquote>`, text
// sharing a line with other static content) — parseInline skips wrapping the
// result in its own <p>, so it can't produce invalid nested-<p> markup or
// break the caller's inline flow. Blank lines in the source collapse to <br>
// (via `breaks: true`) rather than becoming separate paragraphs.
export function renderInlineMarkdown(str: string): string {
  const escaped = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return marked.parseInline(escaped, { breaks: true, async: false });
}

// Strips markdown syntax for plain-text contexts (e.g. JSON-LD step text).
export function stripMarkdown(str: string): string {
  return str
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

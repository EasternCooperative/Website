import { describe, it, expect } from 'vitest';
import { annotateTerms, escapeHtml, glossaryId, glossaryTrigger } from './glossary';

const glossary = [
  { term: 'Adult', short: '13+', definition: 'Ages 13 and up.' },
  { term: 'Child', short: '6-12', definition: 'Ages 6 to 12.' },
];

describe('glossaryId', () => {
  it('slugifies the term', () => {
    expect(glossaryId('Under 6')).toBe('term-under-6');
    expect(glossaryId('Adult')).toBe('term-adult');
  });
});

describe('annotateTerms', () => {
  it('returns the input untouched when there is no glossary', () => {
    expect(annotateTerms('<p>per adult</p>', undefined)).toBe('<p>per adult</p>');
    expect(annotateTerms('<p>per adult</p>', [])).toBe('<p>per adult</p>');
  });

  it('wraps matches case-insensitively and keeps the original casing', () => {
    const out = annotateTerms('<p>$50 per Adult, $25 per child</p>', glossary);
    expect(out).toMatch(/data-popover-target="term-adult"[^>]*>Adult<\/button>/);
    expect(out).toMatch(/data-popover-target="term-child"[^>]*>child<\/button>/);
  });

  it('tolerates a trailing s', () => {
    expect(annotateTerms('<p>adults and children</p>', glossary)).toContain('>adults</button>');
  });

  it('does not match inside longer words', () => {
    const out = annotateTerms('<p>Adulthood and childish</p>', glossary);
    expect(out).toBe('<p>Adulthood and childish</p>');
  });

  it('never touches tag attributes', () => {
    const html = '<p title="adult"><span class="child">x</span></p>';
    expect(annotateTerms(html, glossary)).toBe(html);
  });

  it('leaves text inside links and buttons alone', () => {
    const html = '<a href="/adult">Adult rates</a> <button>Child</button>';
    expect(annotateTerms(html, glossary)).toBe(html);
  });

  it('wraps again after a link closes', () => {
    const out = annotateTerms('<a href="/x">Adult</a> then adult', glossary);
    expect(out.match(/<button/g)).toHaveLength(1);
  });
});

describe('glossaryTrigger', () => {
  it('uses the term as the default label', () => {
    expect(glossaryTrigger(glossary[1])).toContain('>Child</button>');
  });
});

describe('escapeHtml', () => {
  it('escapes ampersands, angle brackets, and double quotes', () => {
    expect(escapeHtml('<a href="x">Tom & Jerry</a>')).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;');
  });

  it('leaves plain text alone', () => {
    expect(escapeHtml('plain text')).toBe('plain text');
  });
});

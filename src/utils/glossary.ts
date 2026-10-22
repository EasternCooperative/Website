export type GlossaryEntry = {
  term: string;
  short?: string;
  definition: string;
};

const TRIGGER_CLASS =
  'underline decoration-dotted underline-offset-2 cursor-pointer hover:text-primary transition-colors';

export function glossaryId(term: string): string {
  return `term-${term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function glossaryTrigger(entry: GlossaryEntry, label: string = entry.term): string {
  const id = glossaryId(entry.term);
  return `<button type="button" data-popover-target="${id}" aria-controls="${id}" aria-expanded="false" class="${TRIGGER_CLASS}">${label}</button>`;
}

/**
 * Wraps whole-word, case-insensitive occurrences of each glossary term (with an
 * optional trailing "s") in popover triggers. Only text nodes are touched, and
 * text already inside a link or button is left alone.
 */
export function annotateTerms(html: string, glossary: GlossaryEntry[] | undefined): string {
  if (!glossary?.length) return html;
  const pattern = new RegExp(
    `\\b(${glossary
      .map((g) => escapeRegExp(g.term))
      .sort((a, b) => b.length - a.length)
      .join('|')})s?\\b`,
    'gi'
  );
  const lookup = new Map(glossary.map((g) => [g.term.toLowerCase(), g]));

  let skipDepth = 0;
  return html
    .split(/(<[^>]+>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        if (/^<(a|button)\b/i.test(part)) skipDepth++;
        else if (/^<\/(a|button)>/i.test(part)) skipDepth = Math.max(0, skipDepth - 1);
        return part;
      }
      if (skipDepth > 0) return part;
      return part.replace(pattern, (match, term: string) => {
        const entry = lookup.get(term.toLowerCase());
        return entry ? glossaryTrigger(entry, match) : match;
      });
    })
    .join('');
}

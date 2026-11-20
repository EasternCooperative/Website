// Proposes which site event each Cognito form belongs to, by year and name. It only
// proposes: nothing is loaded until a person confirms the map, and a form that does not
// match well is left unmapped rather than guessed.

const STOP = new Set([
  'event',
  'registration',
  'participant',
  'at',
  'the',
  'and',
  'of',
  'in',
  'a',
  'for',
  'with',
  'new',
  'form',
]);
// Words that mean the same thing across form names and event titles.
const SAME = {
  onas: 'camping',
  camp: 'camping',
  camping: 'camping',
  zoom: 'virtual',
  workshop: 'winter',
  adventure: 'winter',
};

export const yearOf = (text) => Number(String(text).match(/\b(20\d{2})\b/)?.[1]) || null;

/** Lowercase words, minus filler and the year, with synonyms folded together. */
export function tokens(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !/^\d+$/.test(w) && !STOP.has(w))
      .map((w) => SAME[w] ?? w)
  );
}

// How much of the form's name an event covers, so a place name in the event title
// ("Stony Point") does not count against it. Extra words only break ties.
const cover = (want, have) => (want.size === 0 ? 0 : [...want].filter((t) => have.has(t)).length / want.size);

/**
 * @param forms  [{ formId, name }]
 * @param events [{ slug, title, year }]
 * @returns {{ formId: string, name: string, slug: string | null, score: number, runnerUp: string | null }[]} one row per form; slug is null when unsure
 */
export function proposeMapping(forms, events, { minScore = 0.6 } = {}) {
  return forms.map(({ formId, name }) => {
    const year = yearOf(name);
    const want = tokens(name);
    const ranked = events
      .filter((e) => year !== null && e.year === year)
      .map((e) => {
        const have = tokens(`${e.slug.replace(/^\d{4}-/, '').replace(/-/g, ' ')} ${e.title}`);
        return {
          slug: e.slug,
          score: cover(want, have),
          extra: have.size - [...want].filter((t) => have.has(t)).length,
        };
      })
      .sort((a, b) => b.score - a.score || a.extra - b.extra || a.slug.localeCompare(b.slug));
    const [best, second] = ranked;
    const sure =
      Boolean(best) && best.score >= minScore && (!second || best.score > second.score || best.extra < second.extra);
    return {
      formId: String(formId),
      name,
      slug: sure ? best.slug : null,
      score: best?.score ?? 0,
      runnerUp: sure ? (second?.slug ?? null) : (best?.slug ?? null),
    };
  });
}

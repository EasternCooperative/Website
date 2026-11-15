// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyHighlightFromUrl,
  clearHighlights,
  highlightFromUrl,
  highlightTerms,
  initBookHighlight,
  resetBookHighlightForTests,
  termPattern,
  withHighlight,
} from './bookHighlight';

describe('withHighlight', () => {
  it('adds the words before any anchor, joining an existing query', () => {
    expect(withHighlight('/book/games#wink', ' wink ')).toBe('/book/games?highlight=wink#wink');
    expect(withHighlight('/book/games', 'bat balloon')).toBe('/book/games?highlight=bat%20balloon');
    expect(withHighlight('/book/games?x=1', 'wink')).toBe('/book/games?x=1&highlight=wink');
    expect(withHighlight('/book/games#wink', '  ')).toBe('/book/games#wink');
  });
});

describe('termPattern', () => {
  it('matches words starting with a search word, ignoring case and one-letter words', () => {
    const pattern = termPattern('Ball a balloon')!;
    expect('Balloons, a ball, a football, BALLGAME'.match(pattern)).toEqual(['Balloons', 'ball', 'BALLGAME']);
    expect(termPattern(' a ')).toBeNull();
  });

  it('treats search words literally', () => {
    expect('cost (5) c+ c'.match(termPattern('c+ (5)')!)).toEqual(['(5)', 'c+']);
  });
});

describe('highlightTerms and clearHighlights', () => {
  it('marks matches across elements, skips scripts and marks, and restores the text', () => {
    document.body.innerHTML =
      '<div class="opp-book"><p>Bat the <b>balloon</b>; balloons fly.</p><script>balloon()</script><mark>balloon</mark></div>';
    const root = document.querySelector('.opp-book')!;
    const before = root.innerHTML;

    const marks = highlightTerms(root, 'balloon');
    expect(marks.map((m) => m.textContent)).toEqual(['balloon', 'balloons']);
    expect(root.querySelector('p')!.innerHTML).toBe(
      'Bat the <b><mark class="opp-hit">balloon</mark></b>; <mark class="opp-hit">balloons</mark> fly.'
    );

    clearHighlights(root);
    expect(root.innerHTML).toBe(before);
    expect(root.querySelector('p')!.childNodes).toHaveLength(3); // text nodes merged back
  });

  it('does nothing without usable words', () => {
    document.body.innerHTML = '<div class="opp-book"><p>a b c</p></div>';
    expect(highlightTerms(document.body, 'a')).toEqual([]);
  });
});

describe('highlightFromUrl', () => {
  it('reads the words from the query string', () => {
    expect(highlightFromUrl('?highlight=bat%20balloon')).toBe('bat balloon');
    expect(highlightFromUrl('?other=1')).toBe('');
  });
});

describe('applyHighlightFromUrl', () => {
  const scroll = vi.fn();

  beforeEach(() => {
    scroll.mockReset();
    Element.prototype.scrollIntoView = scroll;
    document.body.innerHTML = '<div class="opp-book"><p>Bat the balloon. Balloons!</p></div>';
  });

  const at = (url: string) => history.replaceState(null, '', url);

  it('highlights, scrolls to the first match, and clears from the bar', () => {
    at('/of-play-and-playfulness/games?highlight=balloon&x=1');
    applyHighlightFromUrl();
    expect(document.querySelectorAll('mark.opp-hit')).toHaveLength(2);
    expect(scroll).toHaveBeenCalledOnce();
    const bar = document.getElementById('opp-hit-bar')!;
    expect(bar.textContent).toContain('2 matches for "balloon"');

    bar.querySelector('button')!.click();
    expect(document.querySelectorAll('mark.opp-hit')).toHaveLength(0);
    expect(document.getElementById('opp-hit-bar')).toBeNull();
    expect(location.search).toBe('?x=1');
  });

  it('scrolls back to the #anchor (now clear of the bar), and counts one match', () => {
    document.querySelector('p')!.id = 'bat_the_balloon';
    at('/of-play-and-playfulness/games?highlight=bat#bat_the_balloon');
    applyHighlightFromUrl();
    expect(scroll).toHaveBeenCalledOnce();
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('bat_the_balloon'));
    expect(document.getElementById('opp-hit-bar')!.textContent).toContain('1 match for "bat"');
  });

  it('skips the re-scroll when the #anchor is not on the page', () => {
    at('/of-play-and-playfulness/games?highlight=bat#nowhere');
    applyHighlightFromUrl();
    expect(scroll).not.toHaveBeenCalled();
    expect(document.getElementById('opp-hit-bar')).not.toBeNull();
  });

  it('does nothing without words, text, or a match, and drops a stale bar', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="opp-hit-bar"></div>');
    at('/of-play-and-playfulness/games');
    applyHighlightFromUrl();
    expect(document.getElementById('opp-hit-bar')).toBeNull();

    at('/of-play-and-playfulness/games?highlight=zebra');
    applyHighlightFromUrl();
    expect(document.getElementById('opp-hit-bar')).toBeNull();

    document.body.innerHTML = '<p>balloon</p>';
    at('/of-play-and-playfulness?highlight=balloon');
    applyHighlightFromUrl();
    expect(document.querySelector('mark')).toBeNull();
  });

  it('runs on each page load once initialized', () => {
    resetBookHighlightForTests();
    at('/of-play-and-playfulness/games?highlight=balloon');
    initBookHighlight();
    initBookHighlight();
    document.dispatchEvent(new Event('astro:page-load'));
    expect(document.querySelectorAll('mark.opp-hit')).toHaveLength(2);
  });
});

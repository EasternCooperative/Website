import { animate, scroll } from 'motion';

type Direction = 'up' | 'left' | 'right' | 'up-light';

const OFFSETS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: 64 },
  left: { x: -80, y: 0 },
  right: { x: 80, y: 0 },
  // Subtler variant for long, densely-repeated lists (e.g. event class listings) where
  // the full-strength blur+slide reveal on every item reads as distracting rather than
  // polished while scrolling through many of them in a row.
  'up-light': { x: 0, y: 16 },
};

// "start X%" in the scroll() offset below means: the effect begins once the element's
// top edge has risen to X% down the viewport. Used to detect, at wire-up time, whether
// an element's reveal window has already been entered by its static position on the
// page (e.g. content that's already mid-page on a fresh load, or a page opened via
// back/forward at a scrolled position) — see the isAlreadyEngaged check below.
const START_PERCENT = 85;
const END_PERCENT = 65;

/**
 * Wires up scroll-linked (scrubbed) reveal animations on every element under `root`
 * carrying a `data-scroll-reveal="up|left|right"` attribute that hasn't been wired yet.
 * Desktop-only and skipped entirely under prefers-reduced-motion, matching the rest of
 * the site's animation conventions. Elements that are `[hidden]` are skipped so callers
 * (e.g. Testimonials' shuffle-and-reveal) can call this again after unhiding content —
 * already-wired elements are never re-processed.
 */
export function initScrollReveal(root: ParentNode = document): void {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDesktop = window.matchMedia('(min-width: 768px)').matches;
  if (prefersReduced || !isDesktop) return;

  root
    .querySelectorAll<HTMLElement>('[data-scroll-reveal]:not([data-scroll-reveal-ready]):not([hidden])')
    .forEach((el) => {
      el.dataset.scrollRevealReady = 'true';

      // If the element's reveal window has already been reached by its static position
      // (e.g. it's already partway down a freshly-loaded page, or the page opened at a
      // scrolled position), scroll-linking it would leave it stuck at whatever partial
      // opacity/blur/offset that position implies until the user scrolls further — which
      // reads as a rendering glitch, not an animation. Just show it fully revealed.
      const startPx = (START_PERCENT / 100) * window.innerHeight;
      if (el.getBoundingClientRect().top <= startPx) return;

      const direction = el.dataset.scrollReveal as Direction;
      const { x, y } = OFFSETS[direction] ?? OFFSETS.up;
      const isLight = direction === 'up-light';

      scroll(
        animate(
          el,
          {
            opacity: [0, 1],
            transform: [`translate(${x}px, ${y}px)`, 'translate(0px, 0px)'],
            ...(isLight ? {} : { filter: ['blur(4px)', 'blur(0px)'] }),
          },
          { duration: isLight ? 0.5 : 1 }
        ),
        { target: el, offset: [`start ${START_PERCENT}%`, `start ${END_PERCENT}%`] }
      );
    });
}

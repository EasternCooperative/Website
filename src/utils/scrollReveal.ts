import { animate, scroll } from 'motion';

type Direction = 'up' | 'left' | 'right';

const OFFSETS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: 64 },
  left: { x: -80, y: 0 },
  right: { x: 80, y: 0 },
};

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
      const direction = el.dataset.scrollReveal as Direction;
      const { x, y } = OFFSETS[direction] ?? OFFSETS.up;

      scroll(
        animate(
          el,
          { opacity: [0, 1], transform: [`translate(${x}px, ${y}px)`, 'translate(0px, 0px)'] },
          { duration: 1 }
        ),
        { target: el, offset: ['start 95%', 'start 55%'] }
      );
    });
}

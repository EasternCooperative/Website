import { scroll } from 'motion';

/**
 * Collapse the decorative hero image on event detail pages as the reader scrolls,
 * so the body content reaches the top of the viewport sooner. The hero's height
 * is scrubbed from its natural size down to zero over a short scroll range; past
 * that range the now-zero-height wrapper just scrolls away as normal flow.
 *
 * ## Why `overflow-anchor`
 *
 * The hero sits at the very top of the page. Once you've scrolled past its top
 * edge, shrinking it removes layout height *above* the viewport, and the
 * browser's scroll anchoring "helpfully" adjusts the scroll position to keep
 * on-screen content still — which this handler then reads and reacts to, so the
 * two oscillate (the hero visibly grows while you scroll down). Disabling scroll
 * anchoring breaks that loop.
 *
 * To keep the blast radius small, anchoring is only disabled while the collapse
 * is in progress (`scrollY <= range`, i.e. near the top of the page, where
 * there's little above you for anchoring to protect anyway) and restored once
 * you're deeper into the article — so late-loading content further down (images,
 * the embedded registration form) keeps its jump protection.
 *
 * ## Other notes
 *   - Skipped under `prefers-reduced-motion`.
 *   - Runs at every viewport width (the payoff is largest on small screens) and
 *     reuses `motion`'s `scroll()`, already the site's scroll-animation lib, so
 *     it works in every browser — unlike CSS `animation-timeline`.
 *   - Idempotent via `data-event-hero-ready`; the scroll/resize subscriptions and
 *     the `overflow-anchor` override are torn down on `astro:before-swap` so
 *     repeated View Transition navigations don't leak them.
 */
const MAX_RANGE_PX = 320; // cap on the scroll distance the collapse is spread over

export function initEventHero(root: ParentNode = document): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const el = root.querySelector<HTMLElement>('[data-event-hero]:not([data-event-hero-ready])');
  if (!el) return;

  // Natural (fully open) height. Read before we touch the box, so it reflects
  // only the static classes (a `vh` value on mobile, an `aspect-ratio` on
  // desktop) and is independent of whether the hero image has loaded.
  let openPx = el.getBoundingClientRect().height;
  if (openPx < 80) return; // not laid out, or nothing worth collapsing

  el.dataset.eventHeroReady = 'true';
  const overlay = el.querySelector<HTMLElement>('[data-event-hero-overlay]');
  const rootEl = document.documentElement;

  let range = Math.min(openPx, MAX_RANGE_PX);
  let anchoringDisabled = false;

  const apply = () => {
    const withinCollapse = window.scrollY <= range + 1;
    if (withinCollapse !== anchoringDisabled) {
      rootEl.style.overflowAnchor = withinCollapse ? 'none' : '';
      anchoringDisabled = withinCollapse;
    }
    const p = Math.min(1, Math.max(0, window.scrollY / range));
    el.style.maxHeight = `${openPx * (1 - p)}px`;
    if (overlay) overlay.style.opacity = `${1 - p}`;
  };

  // Recompute the natural height + range on viewport change (vh units, breakpoint
  // crossings, rotation). Clearing `max-height` to re-measure and restoring it
  // happens within one frame callback, so nothing paints at the intermediate
  // size.
  let raf = 0;
  const onResize = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const restore = el.style.maxHeight;
      el.style.maxHeight = '';
      const measured = el.getBoundingClientRect().height;
      el.style.maxHeight = restore;
      if (measured >= 80) openPx = measured;
      range = Math.min(openPx, MAX_RANGE_PX);
      apply();
    });
  };
  window.addEventListener('resize', onResize, { passive: true });

  // motion's scroll() returns a cleanup fn and gives a passive, rAF-batched
  // scroll subscription.
  const stopScroll = scroll(apply);
  apply();

  document.addEventListener(
    'astro:before-swap',
    () => {
      stopScroll();
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
      rootEl.style.overflowAnchor = '';
    },
    { once: true }
  );
}

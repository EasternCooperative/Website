// `motion` (about 27 KB gzipped) is only needed once there is something to
// animate: never on mobile or under reduced motion, where this module returns
// before touching it. Loaded on demand so those visitors don't download it.
let motionModule: Promise<typeof import('./scrollRevealMotion')> | undefined;
const loadMotion = () => (motionModule ??= import('./scrollRevealMotion'));

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
 * The reveal window for one element, as [start, end] percentages down the viewport.
 *
 * Normally that's the 85% -> 65% default. But an element near the bottom of the page
 * can't always rise to 65%: once the page hits its scroll limit the element stops
 * wherever it is, and on a tall screen (or a short page) that can be well below the
 * end line, leaving it stuck partly transparent and blurred, or never shown at all.
 * `lowestTopPercent` is where the element's top edge sits at the scroll limit; when
 * that's below the default end line, the window is moved down so the reveal finishes
 * just before the page runs out of scroll.
 */
export function revealWindow(lowestTopPercent: number): [start: number, end: number] {
  if (lowestTopPercent <= END_PERCENT) return [START_PERCENT, END_PERCENT];
  // +1 so the reveal completes a hair before the scroll limit rather than exactly on
  // it, where sub-pixel rounding could leave it a fraction short.
  const end = Math.min(99, Math.ceil(lowestTopPercent) + 1);
  const start = Math.max(START_PERCENT, Math.min(100, end + (START_PERCENT - END_PERCENT)));
  return [start, end];
}

/**
 * Wires up scroll-linked (scrubbed) reveal animations on every element under `root`
 * carrying a `data-scroll-reveal="up|left|right"` attribute that hasn't been wired yet.
 * Desktop-only and skipped entirely under prefers-reduced-motion, matching the rest of
 * the site's animation conventions. Elements that are `[hidden]` are skipped so callers
 * (e.g. Testimonials' shuffle-and-reveal) can call this again after unhiding content —
 * already-wired elements are never re-processed.
 *
 * Marking and measuring happen synchronously; the returned promise resolves once the
 * animations are wired (callers don't need to await it).
 */
export async function initScrollReveal(root: ParentNode = document): Promise<void> {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDesktop = window.matchMedia('(min-width: 768px)').matches;
  if (prefersReduced || !isDesktop) return;

  const candidates = root.querySelectorAll<HTMLElement>(
    '[data-scroll-reveal]:not([data-scroll-reveal-ready]):not([hidden])'
  );

  // Read phase: mark every candidate ready and take its geometry up front, before any
  // animate()/scroll() calls below can write styles — interleaving reads and writes here
  // is what causes a forced reflow per element.
  const viewportHeight = window.innerHeight;
  const startPx = (START_PERCENT / 100) * viewportHeight;
  // How much further the page can still scroll from here.
  const remainingScroll = Math.max(0, document.documentElement.scrollHeight - viewportHeight - window.scrollY);
  const toReveal: HTMLElement[] = [];
  const windows = new Map<HTMLElement, [start: number, end: number]>();
  candidates.forEach((el) => {
    el.dataset.scrollRevealReady = 'true';
    const top = el.getBoundingClientRect().top;

    // If the element's reveal window has already been reached by its static position
    // (e.g. it's already partway down a freshly-loaded page, or the page opened at a
    // scrolled position), scroll-linking it would leave it stuck at whatever partial
    // opacity/blur/offset that position implies until the user scrolls further — which
    // reads as a rendering glitch, not an animation. Just show it fully revealed.
    if (top <= startPx) return;
    toReveal.push(el);
    windows.set(el, revealWindow(((top - remainingScroll) / viewportHeight) * 100));
  });

  if (toReveal.length === 0) return;

  // Hide them now, at the state the animation starts from, so nothing in the bottom
  // strip of the viewport flashes visible while the animation library loads.
  toReveal.forEach((el) => {
    el.style.opacity = '0';
  });

  let motion: typeof import('./scrollRevealMotion');
  try {
    motion = await loadMotion();
  } catch {
    // Chunk failed to load (offline, blocked): show the content rather than leave it hidden.
    toReveal.forEach((el) => {
      el.style.opacity = '';
    });
    return;
  }
  const { animate, scroll } = motion;

  // Write phase: wire up the scroll-linked animations now that all geometry has been read.
  toReveal.forEach((el) => {
    const direction = el.dataset.scrollReveal as Direction;
    const { x, y } = OFFSETS[direction] ?? OFFSETS.up;
    const isLight = direction === 'up-light';
    const [start, end] = windows.get(el)!;

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
      { target: el, offset: [`start ${start}%`, `start ${end}%`] }
    );
  });
}

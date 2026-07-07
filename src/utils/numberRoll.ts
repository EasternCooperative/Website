// A reusable "odometer" control for numbers embedded in a sentence — e.g. a
// slider's live label ("At least 6 people"). Only the digits that actually
// change roll like a mechanical counter; the surrounding phrase text stays
// put. When the sentence's own shape changes (e.g. "Any size" → "At least X
// people"), the whole label crossfades instead, since that's a structural
// change, not just a number ticking.
//
// Usage:
//   const label = new RollingLabel(document.getElementById('my-label')!);
//   const changed = label.setShape('atLeast', (l) => {
//     l.text('At least ');
//     l.reel('min', 6);
//     l.text(' people');
//   });
//   if (!changed) label.roll('min', 7); // only roll when the shape didn't just rebuild
//
// Import the companion `<RollingLabel>` Astro component (in
// src/components/common/RollingLabel.astro) for the matching markup wrapper —
// it carries the base classes this module assumes are present.

const ROLL_DURATION_MS = 220;
const ROLL_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SHAPE_FADE_MS = 150;

// Checked per call (not cached) so the control tracks live OS-setting changes.
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Rolls a single character like one wheel of a mechanical odometer: builds a
// two-item vertical track (old char + new char, ordered so the visual travel
// direction matches whether the number went up or down) and transitions it by
// one item's height. Rebuilding fresh on every call (rather than chaining)
// means a rapid drag just interrupts the previous roll cleanly and starts a
// new short one — no stale/leftover nodes.
//
// The digit's own box (size/display/overflow) never changes between rest and
// rolling — only what's inside it does. Toggling the wrapper's own classes
// right as a roll starts/stops switches it between plain inline text and an
// inline-block, which changes how the browser computes the surrounding line's
// box and causes the whole line to visibly shift by a pixel or two right at
// that instant. Keeping the wrapper constant (see the digit classes created in
// rollNumber()) avoids that reflow entirely.
function rollDigit(digitEl: HTMLElement, oldChar: string, newChar: string, goingUp: boolean) {
  if (oldChar === newChar) {
    digitEl.textContent = newChar;
    return;
  }
  digitEl.innerHTML = '';
  const track = document.createElement('span');
  track.className = 'flex flex-col';
  const first = document.createElement('span');
  const second = document.createElement('span');
  first.className = 'leading-none';
  second.className = 'leading-none';
  first.textContent = goingUp ? oldChar : newChar;
  second.textContent = goingUp ? newChar : oldChar;
  track.append(first, second);
  digitEl.appendChild(track);

  track.style.transform = goingUp ? 'translateY(0%)' : 'translateY(-50%)';
  track.getBoundingClientRect(); // force reflow so the starting position is committed
  track.style.transition = `transform ${ROLL_DURATION_MS}ms ${ROLL_EASING}`;
  // A single rAF isn't reliably enough separation from the style changes
  // above — some engines can still coalesce it all into one paint with no
  // visible transition. Nesting two rAFs guarantees a full painted frame has
  // happened in between, so the transition reliably plays.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      track.style.transform = goingUp ? 'translateY(-50%)' : 'translateY(0%)';
    });
  });
  track.addEventListener(
    'transitionend',
    () => {
      digitEl.textContent = newChar;
    },
    { once: true }
  );
}

// Splits the number into individual digit wheels (like a real odometer) so
// only the positions that actually changed roll — e.g. 15→16 only spins the
// ones place. Shorter numbers are padded with a blank wheel on the left so
// digit columns still line up when the digit count changes (6 → 20).
export function rollNumber(reel: HTMLElement, newValue: number) {
  const oldValue = Number(reel.dataset.rollValue ?? newValue);
  reel.dataset.rollValue = String(newValue);
  if (oldValue === newValue || prefersReducedMotion()) {
    reel.textContent = String(newValue);
    return;
  }
  const goingUp = newValue > oldValue;
  const oldStr = String(oldValue);
  const newStr = String(newValue);
  const width = Math.max(oldStr.length, newStr.length);
  const oldPadded = oldStr.padStart(width, ' ');
  const newPadded = newStr.padStart(width, ' ');

  let digitEls = Array.from(reel.querySelectorAll<HTMLElement>(':scope > [data-digit]'));
  if (digitEls.length !== width) {
    reel.innerHTML = '';
    digitEls = [];
    for (let i = 0; i < width; i++) {
      const d = document.createElement('span');
      d.dataset.digit = 'true';
      // relative top-px corrects a small, empirically-measured constant offset
      // between this flex-centered box and the surrounding baseline text.
      d.className = 'relative top-px inline-flex items-center justify-center h-[1em] overflow-hidden leading-none';
      reel.appendChild(d);
      digitEls.push(d);
    }
  }
  for (let i = 0; i < width; i++) {
    rollDigit(digitEls[i], oldPadded[i], newPadded[i], goingUp);
  }
}

// Orchestrates a sentence made of static text plus one or more rolling
// numbers, inside a single container element. The container must already be
// `inline-flex items-center` (see RollingLabel.astro) — every child, text or
// number, is a real flex item centered the same consistent way, rather than
// mixing inline-baseline rules for some children and flex alignment for
// others, which is what caused the alignment bugs this control was built to
// avoid in the first place.
export class RollingLabel {
  private container: HTMLElement;
  private shapeKey: string | null = null;
  private fadeTimer?: ReturnType<typeof setTimeout>;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Call whenever the sentence's structural "shape" might have changed — pick
   * any discriminated string key that identifies the sentence template
   * currently in use (e.g. 'atLeast' | 'between' | 'any'). If the key differs
   * from last time, crossfades the whole container and calls `build` to
   * repopulate it via `.text()`/`.reel()`. If the key is unchanged, this is a
   * no-op — call `.roll()` yourself afterward to update existing reels.
   *
   * Returns true if a rebuild was triggered (so the caller knows NOT to also
   * call `.roll()` this tick — `build()` already set the correct values).
   */
  setShape(shapeKey: string, build: (label: RollingLabel) => void, fadeMs = SHAPE_FADE_MS): boolean {
    if (shapeKey === this.shapeKey) return false;
    this.shapeKey = shapeKey;
    clearTimeout(this.fadeTimer);
    this.container.classList.add('opacity-0');
    this.fadeTimer = setTimeout(
      () => {
        this.container.innerHTML = '';
        build(this);
        this.container.classList.remove('opacity-0');
      },
      prefersReducedMotion() ? 0 : fadeMs
    );
    return true;
  }

  /** Appends a static text segment. Only meaningful inside a `setShape` build callback. */
  text(content: string): HTMLElement {
    const span = document.createElement('span');
    // Being its own flex item means leading/trailing spaces in this span's
    // text would otherwise be trimmed as "edge of box" whitespace (the normal
    // CSS collapsing rule) — whitespace-pre preserves them exactly.
    span.className = 'whitespace-pre';
    span.textContent = content;
    this.container.appendChild(span);
    return span;
  }

  /** Appends a rolling-number reel identified by `role`. Only meaningful inside a `setShape` build callback. */
  reel(role: string, value: number): HTMLElement {
    const reel = document.createElement('span');
    reel.dataset.role = role;
    reel.dataset.rollValue = String(value);
    reel.textContent = String(value);
    reel.className = 'inline-flex items-center tabular-nums';
    this.container.appendChild(reel);
    return reel;
  }

  /** Rolls an existing reel (previously created via `.reel()`) to a new value. */
  roll(role: string, value: number) {
    const reel = this.container.querySelector<HTMLElement>(`[data-role="${role}"]`);
    if (reel) rollNumber(reel, value);
  }
}

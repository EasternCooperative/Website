// Shared behavior for a dual-handle range slider built from two native
// `<input type="range">` elements stacked on one track (see the
// `.range-slider-input` styles in src/assets/styles/tailwind.css). Owns
// clamping (min can't pass max and vice versa), the fill-bar position, and
// which thumb sits on top so both ends stay grabbable at the extremes.
//
// Deliberately framework-agnostic (plain DOM), like src/utils/numberRoll.ts,
// so the same instance can be wired up from an Astro page's inline <script>
// (src/pages/activities/index.astro) or imperatively from a React island via
// a ref + useEffect (src/components/widgets/GalleryBrowser.tsx).
export interface RangeSliderRefs {
  minInput: HTMLInputElement;
  maxInput: HTMLInputElement;
  fill: HTMLElement;
}

export interface RangeSliderOptions {
  boundMin: number;
  boundMax: number;
  onChange?: (min: number, max: number) => void;
}

import type { RollingLabel } from '~/utils/numberRoll';

/** Phrasing for each of the four sentence shapes a dual-handle range label can take. */
export interface RangeLabelPhrasing {
  all: (label: RollingLabel) => void;
  minOnly: (label: RollingLabel, min: number) => void;
  maxOnly: (label: RollingLabel, max: number) => void;
  between: (label: RollingLabel, min: number, max: number) => void;
}

/**
 * Drives a RollingLabel (src/utils/numberRoll.ts) for a dual-handle range —
 * picks which of the four sentence shapes applies (nothing narrowed / only
 * the min moved / only the max moved / both moved) and either rebuilds the
 * label via the caller's phrasing or rolls the existing digit reels. Shared
 * by the Activities group-size filter and the Gallery year filter — see
 * updateGroupSizeLabel in src/utils/activityFilters.ts and the `label` prop
 * on src/components/ui/RangeSlider.tsx.
 */
export function updateRangeLabel(
  label: RollingLabel,
  min: number,
  max: number,
  boundMin: number,
  boundMax: number,
  phrasing: RangeLabelPhrasing
): void {
  const minSet = min > boundMin;
  const maxSet = max < boundMax;
  const shape = minSet && maxSet ? 'between' : minSet ? 'minOnly' : maxSet ? 'maxOnly' : 'all';

  const rebuilt = label.setShape(shape, (l) => {
    if (shape === 'all') phrasing.all(l);
    else if (shape === 'minOnly') phrasing.minOnly(l, min);
    else if (shape === 'maxOnly') phrasing.maxOnly(l, max);
    else phrasing.between(l, min, max);
  });
  if (!rebuilt && shape !== 'all') {
    label.roll('min', min);
    label.roll('max', max);
  }
}

export class RangeSliderControl {
  private refs: RangeSliderRefs;
  private boundMin: number;
  private boundMax: number;
  private onChange?: (min: number, max: number) => void;

  constructor(refs: RangeSliderRefs, options: RangeSliderOptions) {
    this.refs = refs;
    this.boundMin = options.boundMin;
    this.boundMax = options.boundMax;
    this.onChange = options.onChange;

    refs.minInput.addEventListener('input', () => {
      if (Number(refs.minInput.value) > Number(refs.maxInput.value)) {
        refs.minInput.value = refs.maxInput.value;
      }
      this.updateVisuals();
      this.onChange?.(this.min, this.max);
    });

    refs.maxInput.addEventListener('input', () => {
      if (Number(refs.maxInput.value) < Number(refs.minInput.value)) {
        refs.maxInput.value = refs.minInput.value;
      }
      this.updateVisuals();
      this.onChange?.(this.min, this.max);
    });

    this.updateVisuals();
  }

  get min(): number {
    return Number(this.refs.minInput.value);
  }

  get max(): number {
    return Number(this.refs.maxInput.value);
  }

  /** Programmatic set (e.g. reset-to-bounds) — updates the DOM and visuals without firing onChange. */
  setValues(min: number, max: number): void {
    this.refs.minInput.value = String(min);
    this.refs.maxInput.value = String(max);
    this.updateVisuals();
  }

  private updateVisuals(): void {
    const { minInput, fill } = this.refs;
    const minVal = this.min;
    const maxVal = this.max;

    const span = Math.max(1, this.boundMax - this.boundMin);
    const leftPct = ((minVal - this.boundMin) / span) * 100;
    const rightPct = 100 - ((maxVal - this.boundMin) / span) * 100;
    fill.style.left = `${leftPct}%`;
    fill.style.right = `${rightPct}%`;

    // When the two thumbs coincide, the max input (later in the DOM) is on
    // top and wins the pointer. That deadlocks at the far right: max can't
    // move further and min is buried. Putting min on top whenever the pair
    // sits in the upper half of the range keeps a movable thumb grabbable
    // at both extremes.
    minInput.classList.toggle('z-10', minVal > (this.boundMin + this.boundMax) / 2);
  }
}

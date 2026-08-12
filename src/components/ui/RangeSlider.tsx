import { useEffect, useRef, useState } from 'react';
import { RangeSliderControl, updateRangeLabel, type RangeLabelPhrasing } from '~/utils/rangeSlider';
import { RollingLabel } from '~/utils/numberRoll';

/**
 * React counterpart to src/components/ui/RangeSlider.astro — same dual-handle
 * slider (RangeSliderControl) and odometer-digit label (RollingLabel,
 * updateRangeLabel), just self-wiring via refs/useEffect instead of a
 * vanilla-JS caller querying elements by id. Use this on any React-rendered
 * page; use the .astro version + a page-owned filter script (like
 * src/utils/activityFilters.ts) on plain Astro pages.
 */
interface Props {
  rowLabel: string;
  boundMin: number;
  boundMax: number;
  ariaLabelMin: string;
  ariaLabelMax: string;
  phrasing: RangeLabelPhrasing;
  onChange: (min: number, max: number) => void;
  step?: number;
  className?: string;
}

export default function RangeSlider({
  rowLabel,
  boundMin,
  boundMax,
  ariaLabelMin,
  ariaLabelMax,
  phrasing,
  onChange,
  step = 1,
  className = 'max-w-sm',
}: Props) {
  const minInputRef = useRef<HTMLInputElement>(null);
  const maxInputRef = useRef<HTMLInputElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const labelElRef = useRef<HTMLSpanElement>(null);
  const controlRef = useRef<RangeSliderControl | null>(null);
  const labelRef = useRef<RollingLabel | null>(null);
  const [isNarrowed, setIsNarrowed] = useState(false);

  useEffect(() => {
    if (!minInputRef.current || !maxInputRef.current || !fillRef.current || !labelElRef.current) return;
    const label = new RollingLabel(labelElRef.current);
    labelRef.current = label;
    const control = new RangeSliderControl(
      { minInput: minInputRef.current, maxInput: maxInputRef.current, fill: fillRef.current },
      {
        boundMin,
        boundMax,
        onChange: (min, max) => {
          updateRangeLabel(label, min, max, boundMin, boundMax, phrasing);
          setIsNarrowed(min > boundMin || max < boundMax);
          onChange(min, max);
        },
      }
    );
    controlRef.current = control;
    updateRangeLabel(label, control.min, control.max, boundMin, boundMax, phrasing);
    return () => void control;
    // Bounds are computed once from server-rendered data and never change for
    // the lifetime of this component; phrasing/onChange are stable per caller.
  }, [boundMin, boundMax]);

  const handleReset = () => {
    controlRef.current?.setValues(boundMin, boundMax);
    if (labelRef.current) updateRangeLabel(labelRef.current, boundMin, boundMax, boundMin, boundMax, phrasing);
    setIsNarrowed(false);
    onChange(boundMin, boundMax);
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-xs text-muted">{rowLabel}</span>
        <span className="flex items-center gap-2">
          <span
            ref={labelElRef}
            className="inline-flex items-center transition-opacity duration-150 ease-out motion-reduce:transition-none text-xs font-semibold text-default leading-none"
          />
          {isNarrowed && (
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-primary hover:underline leading-none cursor-pointer"
            >
              Reset
            </button>
          )}
        </span>
      </div>
      <div className="relative h-5">
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700" />
        <div
          ref={fillRef}
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-primary"
          style={{ left: '0%', right: '0%' }}
        />
        <input
          ref={minInputRef}
          type="range"
          className="range-slider-input"
          min={boundMin}
          max={boundMax}
          defaultValue={boundMin}
          step={step}
          aria-label={ariaLabelMin}
        />
        <input
          ref={maxInputRef}
          type="range"
          className="range-slider-input"
          min={boundMin}
          max={boundMax}
          defaultValue={boundMax}
          step={step}
          aria-label={ariaLabelMax}
        />
      </div>
    </div>
  );
}

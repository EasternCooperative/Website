import { useEffect, useMemo, useRef, useState } from 'react';
import { Gallery, Item } from 'react-photoswipe-gallery';
import type PhotoSwipe from 'photoswipe';
import RangeSlider from '~/components/ui/RangeSlider';
import type { RangeLabelPhrasing } from '~/utils/rangeSlider';
import 'photoswipe/style.css';

// PhotoSwipe's arrow-key handler jumps to the next/prev slide instantly
// (mainScroll.moveIndexBy without `animate`) — the spring-slide transition is
// only used for touch/pointer-drag release. `arrowKeys: false` (below, in the
// Gallery `options`) turns that instant jump off, and this reproduces
// arrow-key navigation ourselves via the same internal method, but passing
// `animate: true` so it takes the animated path instead.
function onGalleryOpen(pswp: PhotoSwipe) {
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') pswp.mainScroll.moveIndexBy(-1, true);
    else if (e.key === 'ArrowRight') pswp.mainScroll.moveIndexBy(1, true);
  };
  document.addEventListener('keydown', handleKeydown);
  pswp.on('destroy', () => document.removeEventListener('keydown', handleKeydown));
}

const yearLabelPhrasing: RangeLabelPhrasing = {
  all: (l) => l.text('All years'),
  minOnly: (l, min) => {
    l.text('Since ');
    l.reel('min', min);
  },
  maxOnly: (l, max) => {
    l.text('Through ');
    l.reel('max', max);
  },
  between: (l, min, max) => {
    l.reel('min', min);
    l.text(' – ');
    l.reel('max', max);
  },
};

export interface GalleryPhoto {
  id: string;
  src: string;
  full: string;
  width: number;
  height: number;
  alt: string;
  caption?: string;
  year?: number;
  photographer?: string;
  event?: string;
}

interface Props {
  photos: GalleryPhoto[];
  years: number[];
  photographers: string[];
  events: string[];
}

const PAGE_SIZE = 48;

// Sentinel select value meaning "only photos where this field is missing" —
// distinct from '' (no filter applied), and from any real photographer/event
// name since those come from CMS-authored strings.
const UNKNOWN = '__unknown__';

export default function GalleryBrowser({ photos, years, photographers, events }: Props) {
  const yearBoundMin = years.length ? Math.min(...years) : 0;
  const yearBoundMax = years.length ? Math.max(...years) : 0;

  const [search, setSearch] = useState('');
  const [yearRange, setYearRange] = useState<[number, number]>([yearBoundMin, yearBoundMax]);
  const [photographer, setPhotographer] = useState('');
  const [event, setEvent] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const yearFilterActive = yearRange[0] > yearBoundMin || yearRange[1] < yearBoundMax;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return photos.filter((p) => {
      if (yearFilterActive) {
        if (p.year == null) return false;
        if (p.year < yearRange[0] || p.year > yearRange[1]) return false;
      }
      if (photographer === UNKNOWN) {
        if (p.photographer) return false;
      } else if (photographer && p.photographer !== photographer) return false;
      if (event === UNKNOWN) {
        if (p.event) return false;
      } else if (event && p.event !== event) return false;
      if (q) {
        const haystack = `${p.caption ?? ''} ${p.alt} ${p.event ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [photos, search, yearFilterActive, yearRange, photographer, event]);

  const visible = filtered.slice(0, visibleCount);

  const resetPaging = () => setVisibleCount(PAGE_SIZE);

  // Infinite scroll: bump visibleCount whenever the sentinel below the grid
  // enters the viewport. filteredLengthRef keeps the observer's callback (set
  // up once, on mount) from closing over a stale `filtered.length` — a plain
  // dependency-array re-run would otherwise mean re-creating the observer
  // (and losing its scroll position tracking) on every filter change.
  const filteredLengthRef = useRef(filtered.length);
  filteredLengthRef.current = filtered.length;
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((c) => (c < filteredLengthRef.current ? c + PAGE_SIZE : c));
        }
      },
      { rootMargin: '600px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const selectClass =
    'rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-page dark:text-gray-200';

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="search"
          placeholder="Search captions, events…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetPaging();
          }}
          className={`${selectClass} grow min-w-[200px]`}
          aria-label="Search photos"
        />
        <select
          value={photographer}
          onChange={(e) => {
            setPhotographer(e.target.value);
            resetPaging();
          }}
          className={selectClass}
          aria-label="Filter by photographer"
        >
          <option value="">All photographers</option>
          <option value={UNKNOWN}>Unknown</option>
          {photographers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={event}
          onChange={(e) => {
            setEvent(e.target.value);
            resetPaging();
          }}
          className={selectClass}
          aria-label="Filter by event"
        >
          <option value="">All events</option>
          <option value={UNKNOWN}>Unknown</option>
          {events.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>
      </div>

      {years.length > 0 && (
        <RangeSlider
          rowLabel="Year"
          boundMin={yearBoundMin}
          boundMax={yearBoundMax}
          ariaLabelMin="Minimum year"
          ariaLabelMax="Maximum year"
          phrasing={yearLabelPhrasing}
          onChange={(min, max) => {
            setYearRange([min, max]);
            resetPaging();
          }}
          className="max-w-2xl mx-auto mb-8"
        />
      )}

      <p className="text-sm text-muted mb-4">
        {filtered.length} {filtered.length === 1 ? 'photo' : 'photos'}
      </p>

      <Gallery withCaption options={{ arrowKeys: false }} onOpen={onGalleryOpen}>
        <ul
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 list-none p-0 m-0"
          role="list"
        >
          {visible.map((photo) => (
            <li key={photo.id}>
              <Item
                original={photo.full}
                thumbnail={photo.src}
                width={photo.width}
                height={photo.height}
                alt={photo.alt}
                caption={photo.year ? `${photo.year} — ${photo.caption ?? photo.alt}` : (photo.caption ?? photo.alt)}
              >
                {({ ref, open }) => (
                  <button
                    type="button"
                    onClick={open}
                    className="block w-full aspect-square overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800"
                  >
                    <img
                      ref={ref as React.Ref<HTMLImageElement>}
                      src={photo.src}
                      alt={photo.alt}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
                    />
                  </button>
                )}
              </Item>
            </li>
          ))}
        </ul>
      </Gallery>

      {/* Always rendered (not conditional on hasMore) so its DOM node — and the
          IntersectionObserver watching it, set up once on mount — never gets
          torn down and silently stop working. */}
      <div ref={sentinelRef} className="h-1" aria-hidden="true" />

      {filtered.length === 0 && <p className="text-muted text-lg py-12 text-center">No photos match your filters.</p>}
    </div>
  );
}

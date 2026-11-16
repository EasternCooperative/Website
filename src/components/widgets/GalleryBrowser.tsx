import { useEffect, useMemo, useRef, useState } from 'react';
import { Gallery, Item } from 'react-photoswipe-gallery';
import type PhotoSwipe from 'photoswipe';
import RangeSlider from '~/components/ui/RangeSlider';
import type { RangeLabelPhrasing } from '~/utils/rangeSlider';
import 'photoswipe/style.css';
import GalleryVideoPlayer, { playOnOpen } from '~/components/widgets/GalleryVideoPlayer';

// PhotoSwipe's arrow-key handler jumps to the next/prev slide instantly
// (mainScroll.moveIndexBy without `animate`) — the spring-slide transition is
// only used for touch/pointer-drag release. `arrowKeys: false` (below, in the
// Gallery `options`) turns that instant jump off, and this reproduces
// arrow-key navigation ourselves via the same internal method, but passing
// `animate: true` so it takes the animated path instead.
//
// Video slides: a video keeps playing after you swipe away from it unless it is
// paused, so every video in the lightbox is paused on slide change and close.
// Arrow keys pressed while the player has focus belong to its own seek controls
// (focus may be on one of the player's buttons rather than the <video> itself).
const PLAYER = '.ecrs-player';
// Player controls a pointer drag should operate rather than swipe slides:
// buttons, menus, and slider parts (which all carry data-orientation). Matched
// by role and data attribute, not Video.js's private class names.
const PLAYER_CONTROL = ['button', '[role="button"]', '[role="menu"]', '[role^="menuitem"]', '[data-orientation]']
  .map((c) => `${PLAYER} ${c}`)
  .join(', ');
export function onGalleryOpen(pswp: PhotoSwipe) {
  window.ecrsTrack?.('gallery_photo_open');
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.target instanceof Element && e.target.closest(PLAYER)) return;
    if (e.key === 'ArrowLeft') pswp.mainScroll.moveIndexBy(-1, true);
    else if (e.key === 'ArrowRight') pswp.mainScroll.moveIndexBy(1, true);
  };
  const pauseVideos = () => {
    pswp.element?.querySelectorAll('video').forEach((v) => v.pause());
  };
  document.addEventListener('keydown', handleKeydown);
  // A drag on the video player's scrubber, volume slider, or settings menu
  // would otherwise also count as a swipe to the next slide. Swiping across
  // the picture itself still changes slides.
  pswp.on('pointerDown', (e) => {
    const t = e.originalEvent.target;
    if (t instanceof Element && t.closest(PLAYER_CONTROL)) {
      e.preventDefault();
    }
  });
  // Video slides get a solid black backdrop instead of PhotoSwipe's
  // translucent one, so the page doesn't show through around the player.
  // (applyBgOpacity is a multiplier on options.bgOpacity, which the open,
  // close, and drag-to-close animations also read, so switch the option.)
  const photoBgOpacity = pswp.options.bgOpacity;
  const backdrop = () => {
    const isVideo = !!pswp.currSlide?.holderElement?.querySelector(PLAYER);
    pswp.options.bgOpacity = isVideo ? 1 : photoBgOpacity;
    pswp.applyBgOpacity(1);
  };
  pswp.on('change', backdrop);
  pswp.on('openingAnimationEnd', backdrop);
  pswp.on('change', pauseVideos);
  pswp.on('close', pauseVideos);
  pswp.on('destroy', () => document.removeEventListener('keydown', handleKeydown));
}

const ORIGINAL_ICON_PATH =
  'M23 23H9V9h7V7H9a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM18 7v2h3.59l-9.83 9.83 1.41 1.41L23 10.41V14h2V7h-7z';
const ORIGINAL_ICON = `<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" width="32" height="32"><path class="pswp__icn-shadow" d="${ORIGINAL_ICON_PATH}"/><path d="${ORIGINAL_ICON_PATH}"/></svg>`;

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
  /** Untouched source file under /images/, offered via the lightbox's "original" button. */
  originalSrc?: string;
  width: number;
  height: number;
  alt: string;
  caption?: string;
  year?: number;
  photographer?: string;
  event?: string;
  /** Present for videos: `src`/`full` then hold the poster image, and
   * `width`/`height` are the poster's (so the video's) dimensions. */
  video?: GalleryVideo;
}

export interface GalleryVideo {
  src: string;
  /** WebVTT captions file. */
  captions: string;
  /** Display length, e.g. "5:27". */
  duration?: string;
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

type MediaType = '' | 'photo' | 'video';

function countLabel(items: GalleryPhoto[]): string {
  const videos = items.filter((p) => p.video).length;
  const photos = items.length - videos;
  const photoText = `${photos} ${photos === 1 ? 'photo' : 'photos'}`;
  if (!videos) return photoText;
  const videoText = `${videos} ${videos === 1 ? 'video' : 'videos'}`;
  return photos ? `${photoText}, ${videoText}` : videoText;
}

export default function GalleryBrowser({ photos, years, photographers, events }: Props) {
  const yearBoundMin = years.length ? Math.min(...years) : 0;
  const yearBoundMax = years.length ? Math.max(...years) : 0;

  // Lightbox button that opens the untouched source file in a new tab. Slides
  // are keyed by their optimized `full` URL (PhotoSwipe's `src`), so look the
  // original up from that. Hidden for photos with no local original.
  const lightboxUiElements = useMemo(() => {
    const originals = new Map(photos.map((p) => [p.full, p.originalSrc]));
    const current = (pswp: PhotoSwipe) => originals.get(pswp.currSlide?.data.src ?? '');
    return [
      {
        name: 'original-link',
        order: 9,
        isButton: true,
        html: ORIGINAL_ICON,
        onInit: (el: HTMLElement, pswp: PhotoSwipe) => {
          el.setAttribute('title', 'Open original');
          el.setAttribute('aria-label', 'Open original photo in a new tab');
          pswp.on('change', () => {
            el.style.display = current(pswp) ? '' : 'none';
          });
        },
        onClick: (_e: MouseEvent, _el: HTMLElement, pswp: PhotoSwipe) => {
          const url = current(pswp);
          if (!url) return;
          window.ecrsTrack?.('gallery_original_open');
          window.open(url, '_blank', 'noopener');
        },
      },
    ];
  }, [photos]);

  const [search, setSearch] = useState('');
  const [yearRange, setYearRange] = useState<[number, number]>([yearBoundMin, yearBoundMax]);
  const [photographer, setPhotographer] = useState('');
  const [event, setEvent] = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('');
  const hasVideos = useMemo(() => photos.some((p) => p.video), [photos]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const yearFilterActive = yearRange[0] > yearBoundMin || yearRange[1] < yearBoundMax;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return photos.filter((p) => {
      if (mediaType === 'video' && !p.video) return false;
      if (mediaType === 'photo' && p.video) return false;
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
  }, [photos, search, yearFilterActive, yearRange, photographer, event, mediaType]);

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
          aria-label={hasVideos ? 'Search photos and videos' : 'Search photos'}
          data-track-search="gallery"
        />
        {hasVideos && (
          <select
            value={mediaType}
            onChange={(e) => {
              setMediaType(e.target.value as MediaType);
              resetPaging();
            }}
            className={selectClass}
            aria-label="Filter by type"
            data-track-filter="type"
          >
            <option value="">Photos and videos</option>
            <option value="photo">Photos only</option>
            <option value="video">Videos only</option>
          </select>
        )}
        <select
          value={photographer}
          onChange={(e) => {
            setPhotographer(e.target.value);
            resetPaging();
          }}
          className={selectClass}
          aria-label="Filter by photographer"
          data-track-filter="photographer"
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
          data-track-filter="event"
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

      <p className="text-sm text-muted mb-4">{countLabel(filtered)}</p>

      <Gallery withCaption options={{ arrowKeys: false }} onOpen={onGalleryOpen} uiElements={lightboxUiElements}>
        <ul
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 list-none p-0 m-0"
          role="list"
        >
          {visible.map((photo) => {
            const caption = photo.year ? `${photo.year} — ${photo.caption ?? photo.alt}` : (photo.caption ?? photo.alt);
            const { video } = photo;
            return (
              <li key={photo.id}>
                <Item
                  {...(video
                    ? {
                        content: (
                          <GalleryVideoPlayer
                            src={video.src}
                            captions={video.captions}
                            poster={photo.full}
                            title={photo.alt}
                            aspect={photo.width / photo.height}
                          />
                        ),
                      }
                    : { original: photo.full, width: photo.width, height: photo.height })}
                  thumbnail={photo.src}
                  alt={photo.alt}
                  caption={caption}
                >
                  {({ ref, open }) => (
                    <button
                      type="button"
                      onClick={(e) => {
                        if (video) playOnOpen(video.src);
                        open(e);
                      }}
                      aria-label={video ? `Play video: ${photo.alt}` : undefined}
                      className="relative block w-full aspect-square overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800"
                    >
                      <img
                        ref={ref as React.Ref<HTMLImageElement>}
                        src={photo.src}
                        alt={video ? '' : photo.alt}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
                      />
                      {video && (
                        <span
                          className="pointer-events-none absolute inset-0 flex items-center justify-center"
                          aria-hidden="true"
                        >
                          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white">
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                          {video.duration && (
                            <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
                              {video.duration}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  )}
                </Item>
              </li>
            );
          })}
        </ul>
      </Gallery>

      {/* Always rendered (not conditional on hasMore) so its DOM node — and the
          IntersectionObserver watching it, set up once on mount — never gets
          torn down and silently stop working. */}
      <div ref={sentinelRef} className="h-1" aria-hidden="true" />

      {filtered.length === 0 && (
        <p className="text-muted text-lg py-12 text-center">
          {hasVideos ? 'Nothing matches your filters.' : 'No photos match your filters.'}
        </p>
      )}
    </div>
  );
}

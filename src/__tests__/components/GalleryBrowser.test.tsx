// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import GalleryBrowser, { type GalleryPhoto } from '~/components/widgets/GalleryBrowser';
import { cleanup, render, settle, textOf, type } from '../react';

// Opening the lightbox needs a real layout engine; the grid and filters do not.
// The mock keeps the props the real Gallery hands to PhotoSwipe, so tests can
// drive the open hook and the custom toolbar button with a stand-in lightbox.
const galleryProps: { current?: GalleryMockProps } = {};
interface GalleryMockProps {
  onOpen: (pswp: unknown) => void;
  uiElements: {
    onInit: (el: HTMLElement, pswp: unknown) => void;
    onClick: (e: MouseEvent, el: HTMLElement, pswp: unknown) => void;
  }[];
}
vi.mock('react-photoswipe-gallery', () => ({
  Gallery: ({ children, ...props }: { children: React.ReactNode } & GalleryMockProps) => {
    galleryProps.current = props;
    return <div data-gallery>{children}</div>;
  },
  Item: ({
    children,
    caption,
    content,
  }: {
    children: (api: { ref: () => void; open: () => void }) => React.ReactNode;
    caption: string;
    content?: React.ReactNode;
  }) => (
    <div data-caption={caption}>
      {children({ ref: () => {}, open: () => {} })}
      {content && <div data-slide>{content}</div>}
    </div>
  ),
}));
vi.mock('photoswipe/style.css', () => ({}));

let observe: ReturnType<typeof vi.fn>;
let disconnect: ReturnType<typeof vi.fn>;
let notify: (isIntersecting: boolean) => void;

beforeEach(() => {
  observe = vi.fn();
  disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        notify = (isIntersecting) => cb([{ isIntersecting }]);
      }
      observe = observe;
      disconnect = disconnect;
    }
  );
  // jsdom has no ResizeObserver; the video player uses one to keep captions
  // clear of its controls.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    }
  );
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(async () => {
  await cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const photo = (id: number, over: Partial<GalleryPhoto> = {}): GalleryPhoto => ({
  id: String(id),
  src: `/p/${id}.webp`,
  full: `/p/${id}-full.webp`,
  width: 800,
  height: 600,
  alt: `Photo ${id}`,
  ...over,
});

const photos: GalleryPhoto[] = [
  photo(1, { year: 2019, caption: 'Contra dance', event: 'Winter Adventure', photographer: 'Pat' }),
  photo(2, { year: 2024, caption: 'Circle game', event: 'Camping Weekend', photographer: 'Sam' }),
  photo(3, { year: 2024, caption: 'Kids crafts', event: 'Winter Adventure' }),
  photo(4, { caption: 'Undated scarf dance', photographer: 'Pat' }),
];

async function mount(list = photos) {
  const { container } = await render(
    <GalleryBrowser
      photos={list}
      years={[2019, 2024]}
      photographers={['Pat', 'Sam']}
      events={['Camping Weekend', 'Winter Adventure']}
    />
  );
  await settle();
  return container;
}
const count = (root: ParentNode) => textOf(root.querySelector('p.text-sm')!);
const imgs = (root: ParentNode) => root.querySelectorAll('img').length;

async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('GalleryBrowser', () => {
  it('shows every photo and how many there are', async () => {
    const container = await mount();
    expect(count(container)).toBe('4 photos');
    expect(imgs(container)).toBe(4);
  });

  it('captions each photo with its year when it has one', async () => {
    const container = await mount();
    const captions = [...container.querySelectorAll('[data-caption]')].map((e) => e.getAttribute('data-caption'));
    expect(captions).toEqual([
      '2019 — Contra dance',
      '2024 — Circle game',
      '2024 — Kids crafts',
      'Undated scarf dance',
    ]);
  });

  it('searches captions, alt text, and event names', async () => {
    const container = await mount();
    const search = container.querySelector<HTMLInputElement>('input[type=search]')!;

    await type(search, 'dance');
    expect(count(container)).toBe('2 photos');

    await type(search, 'camping');
    expect(count(container)).toBe('1 photo');

    await type(search, 'photo 3');
    expect(count(container)).toBe('1 photo');

    await type(search, 'zzz');
    expect(count(container)).toBe('0 photos');
    expect(textOf(container)).toContain('No photos match your filters.');
  });

  it('filters by photographer, including photos with none recorded', async () => {
    const container = await mount();
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Filter by photographer"]')!;

    await choose(select, 'Pat');
    expect(count(container)).toBe('2 photos');
    await choose(select, '__unknown__');
    expect(count(container)).toBe('1 photo');
    expect(container.querySelector('img')!.getAttribute('alt')).toBe('Photo 3');
    await choose(select, '');
    expect(count(container)).toBe('4 photos');
  });

  it('filters by event, including photos with none recorded', async () => {
    const container = await mount();
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Filter by event"]')!;

    await choose(select, 'Winter Adventure');
    expect(count(container)).toBe('2 photos');
    await choose(select, '__unknown__');
    expect(count(container)).toBe('1 photo');
  });

  it('filters by year range, leaving out undated photos while a range is set', async () => {
    const container = await mount();
    const min = container.querySelector<HTMLInputElement>('input[aria-label="Minimum year"]')!;

    await act(async () => {
      min.value = '2024';
      min.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(count(container)).toBe('2 photos');
  });

  it('combines filters', async () => {
    const container = await mount();
    await choose(
      container.querySelector<HTMLSelectElement>('select[aria-label="Filter by event"]')!,
      'Winter Adventure'
    );
    await choose(container.querySelector<HTMLSelectElement>('select[aria-label="Filter by photographer"]')!, 'Pat');
    expect(count(container)).toBe('1 photo');
  });

  it('loads more photos as the end of the grid scrolls into view, and stops at the last one', async () => {
    const many = Array.from({ length: 100 }, (_, i) => photo(i + 1, { year: 2020 }));
    const container = await mount(many);
    expect(imgs(container)).toBe(48);
    expect(count(container)).toBe('100 photos');

    await act(async () => notify(true));
    expect(imgs(container)).toBe(96);
    await act(async () => notify(true));
    expect(imgs(container)).toBe(100);
    await act(async () => notify(true));
    expect(imgs(container)).toBe(100);
  });

  it('ignores the end of the grid being scrolled out of view', async () => {
    const many = Array.from({ length: 100 }, (_, i) => photo(i + 1));
    const container = await mount(many);
    await act(async () => notify(false));
    expect(imgs(container)).toBe(48);
  });

  it('starts paging over again when a filter changes', async () => {
    const many = Array.from({ length: 100 }, (_, i) => photo(i + 1, { caption: i % 2 ? 'odd' : 'even' }));
    const container = await mount(many);
    await act(async () => notify(true));
    expect(imgs(container)).toBe(96);

    await type(container.querySelector<HTMLInputElement>('input[type=search]')!, 'odd');

    expect(count(container)).toBe('50 photos');
    expect(imgs(container)).toBe(48);
  });

  it('watches the end of the grid once, and stops when it goes away', async () => {
    await mount();
    expect(observe).toHaveBeenCalledOnce();
    await cleanup();
    expect(disconnect).toHaveBeenCalled();
  });

  it('has no year slider when no photo has a year', async () => {
    const { container } = await render(
      <GalleryBrowser photos={[photo(1)]} years={[]} photographers={[]} events={[]} />
    );
    await settle();
    expect(container.querySelector('input[type=range]')).toBeNull();
    expect(count(container)).toBe('1 photo');
  });

  describe('videos', () => {
    const video = (id: number, over: Partial<GalleryPhoto> = {}): GalleryPhoto =>
      photo(id, {
        alt: `Video ${id}`,
        video: { src: `https://media.example/${id}.mp4`, captions: `/v/${id}.vtt`, duration: '5:27' },
        ...over,
      });
    const mixed = [...photos, video(5, { year: 2009, event: 'Spring Weekend 2009' }), video(6)];
    const typeSelect = (root: ParentNode) =>
      root.querySelector<HTMLSelectElement>('select[aria-label="Filter by type"]');

    it('has no type filter when there are only photos', async () => {
      const container = await mount();
      expect(typeSelect(container)).toBeNull();
      expect(container.querySelector('input[type=search]')!.getAttribute('aria-label')).toBe('Search photos');
    });

    it('mixes videos into the grid and counts them separately', async () => {
      const container = await mount(mixed);
      expect(count(container)).toBe('4 photos, 2 videos');
      expect(container.querySelector('input[type=search]')!.getAttribute('aria-label')).toBe(
        'Search photos and videos'
      );
      const tiles = [...container.querySelectorAll('button[aria-label^="Play video"]')];
      expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual(['Play video: Video 5', 'Play video: Video 6']);
      expect(textOf(tiles[0])).toContain('5:27');
    });

    it('plays each video in the lightbox with its captions', async () => {
      const container = await mount([video(5)]);
      const slide = container.querySelector('[data-slide] video')!;
      expect(slide.getAttribute('aria-label')).toBe('Video 5');
      expect(slide.querySelector('source')!.getAttribute('src')).toBe('https://media.example/5.mp4');
      expect(slide.querySelector('track')!.getAttribute('src')).toBe('/v/5.vtt');
    });

    it('filters by type', async () => {
      const container = await mount(mixed);
      const select = typeSelect(container)!;

      await choose(select, 'video');
      expect(count(container)).toBe('2 videos');
      await choose(select, 'photo');
      expect(count(container)).toBe('4 photos');
      await choose(select, '');
      expect(count(container)).toBe('4 photos, 2 videos');
    });

    it('says nothing matches when filters leave no photos or videos', async () => {
      const container = await mount(mixed);
      await type(container.querySelector<HTMLInputElement>('input[type=search]')!, 'zzz');
      expect(count(container)).toBe('0 photos');
      expect(textOf(container)).toContain('Nothing matches your filters.');
    });

    it('treats a lone video without a duration as one video', async () => {
      const container = await mount([video(7, { video: { src: '/7.mp4', captions: '/7.vtt' } })]);
      expect(count(container)).toBe('1 video');
      expect(textOf(container.querySelector('button[aria-label^="Play video"]')!)).toBe('');
    });
  });

  describe('lightbox', () => {
    // Just enough of PhotoSwipe for the open hook and the "open original" button.
    function fakeLightbox(src: string) {
      const handlers: Record<string, (() => void)[]> = {};
      return {
        currSlide: { data: { src }, holderElement: document.createElement('div') },
        options: { bgOpacity: 0.8 },
        applyBgOpacity: vi.fn(),
        mainScroll: { moveIndexBy: vi.fn() },
        on: (name: string, fn: () => void) => (handlers[name] ??= []).push(fn),
        emit: (name: string) => handlers[name]?.forEach((fn) => fn()),
      };
    }

    let track: ReturnType<typeof vi.fn<(eventName: string) => void>>;
    beforeEach(() => {
      track = vi.fn<(eventName: string) => void>();
      window.ecrsTrack = track;
    });
    afterEach(() => {
      delete window.ecrsTrack;
    });

    it('counts an open and animates arrow-key navigation until it closes', async () => {
      await mount();
      const pswp = fakeLightbox('/p/1-full.webp');
      galleryProps.current!.onOpen(pswp);
      expect(track).toHaveBeenCalledWith('gallery_photo_open');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(pswp.mainScroll.moveIndexBy.mock.calls).toEqual([
        [1, true],
        [-1, true],
      ]);

      pswp.emit('destroy');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(pswp.mainScroll.moveIndexBy).toHaveBeenCalledTimes(2);
    });

    it('pauses videos when the slide changes or the lightbox closes', async () => {
      await mount();
      const element = document.createElement('div');
      const v = document.createElement('video');
      const pause = vi.spyOn(v, 'pause').mockImplementation(() => {});
      element.append(v);
      const pswp = { ...fakeLightbox('/p/1-full.webp'), element };
      galleryProps.current!.onOpen(pswp);

      pswp.emit('change');
      pswp.emit('close');
      expect(pause).toHaveBeenCalledTimes(2);
    });

    it('gives video slides a solid backdrop and photos the usual one', async () => {
      await mount();
      const pswp = fakeLightbox('/p/1-full.webp');
      galleryProps.current!.onOpen(pswp);
      pswp.currSlide.holderElement.append(document.createElement('media-controller'));
      pswp.emit('change');
      expect(pswp.options.bgOpacity).toBe(1);
      pswp.currSlide.holderElement.replaceChildren();
      pswp.emit('change');
      expect(pswp.options.bgOpacity).toBe(0.8);
    });

    it('leaves arrow keys to a focused video player', async () => {
      await mount();
      const pswp = fakeLightbox('/p/1-full.webp');
      galleryProps.current!.onOpen(pswp);
      // Focus may be on the <video> or on one of the player's own controls.
      const player = document.createElement('media-controller');
      const v = document.createElement('video');
      const button = document.createElement('media-play-button');
      player.append(v, button);
      document.body.append(player);
      v.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      expect(pswp.mainScroll.moveIndexBy).not.toHaveBeenCalled();
      pswp.emit('change');
      pswp.emit('destroy');
    });

    it('opens and counts the original only for photos that have one', async () => {
      await mount([photo(1, { originalSrc: 'https://example.com/1.jpg' }), photo(2)]);
      const open = vi.spyOn(window, 'open').mockImplementation(() => null);
      const [button] = galleryProps.current!.uiElements;
      const el = document.createElement('button');

      const withOriginal = fakeLightbox('/p/1-full.webp');
      button.onInit(el, withOriginal);
      expect(el.getAttribute('aria-label')).toBe('Open original photo in a new tab');
      withOriginal.emit('change');
      expect(el.style.display).toBe('');
      button.onClick(new MouseEvent('click'), el, withOriginal);
      expect(open).toHaveBeenCalledWith('https://example.com/1.jpg', '_blank', 'noopener');
      expect(track).toHaveBeenCalledWith('gallery_original_open');

      const withoutOriginal = fakeLightbox('/p/2-full.webp');
      button.onInit(el, withoutOriginal);
      withoutOriginal.emit('change');
      expect(el.style.display).toBe('none');
      button.onClick(new MouseEvent('click'), el, withoutOriginal);
      expect(open).toHaveBeenCalledOnce();
      expect(track).toHaveBeenCalledOnce();
    });
  });
});

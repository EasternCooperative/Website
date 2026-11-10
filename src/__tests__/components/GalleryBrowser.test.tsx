// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import GalleryBrowser, { type GalleryPhoto } from '~/components/widgets/GalleryBrowser';
import { cleanup, render, settle, textOf, type } from '../react';

// Opening the lightbox needs a real layout engine; the grid and filters do not.
vi.mock('react-photoswipe-gallery', () => ({
  Gallery: ({ children }: { children: React.ReactNode }) => <div data-gallery>{children}</div>,
  Item: ({
    children,
    caption,
  }: {
    children: (api: { ref: () => void; open: () => void }) => React.ReactNode;
    caption: string;
  }) => <div data-caption={caption}>{children({ ref: () => {}, open: () => {} })}</div>,
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
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import GalleryVideoPlayer, {
  PLAYBACK_RATES,
  RATE_KEY,
  readSavedRate,
  saveRate,
} from '~/components/widgets/GalleryVideoPlayer';
import { cleanup, render } from '../react';

// Video.js needs a real browser (e2e/gallery-video.spec.ts drives the real
// skin). Here the preset is a stand-in: plain elements plus a tiny store with
// the slice of the player API the component uses (target, playbackRate,
// setPlaybackRate, subscribe), so the tests cover the remembered speed.
const fake = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  // Like the real store, notifications are batched per microtask.
  // `sync` notifies immediately instead, to check the restore can't recurse.
  const notify = () => {
    const run = () => listeners.forEach((l) => l());
    if (store.sync) run();
    else queueMicrotask(run);
  };
  const store = {
    sync: false,
    target: null as object | null,
    state: { playbackRate: 1 },
    setPlaybackRate: (rate: number) => {
      store.state = { ...store.state, playbackRate: rate };
      notify();
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Simulates the player attaching to its <video>. */
    attach: () => {
      store.target = {};
      notify();
    },
    reset: () => {
      listeners.clear();
      store.target = null;
      store.sync = false;
      store.state = { playbackRate: 1 };
    },
  };
  return { store, playerProps: {} as Record<string, unknown> };
});

vi.mock('@videojs/react/video', async () => {
  const { useSyncExternalStore } = await import('react');
  const { store, playerProps } = fake;
  return {
    VideoPlayer: ({ children, ...props }: { children: React.ReactNode }) => {
      Object.assign(playerProps, props);
      return <div data-player>{children}</div>;
    },
    VideoSkin: ({ children, ...props }: { children: React.ReactNode }) => <div {...props}>{children}</div>,
    Video: ({ children, ...props }: { children: React.ReactNode }) => <video {...props}>{children}</video>,
    usePlayer: (selector?: (s: typeof store.state) => unknown) => {
      const state = useSyncExternalStore(store.subscribe, () => store.state);
      return selector ? selector(state) : store;
    },
  };
});
vi.mock('@videojs/react/video/skin.css', () => ({}));
vi.mock('~/assets/styles/gallery-video-player.css', () => ({}));

beforeEach(() => {
  localStorage.clear();
  fake.store.reset();
});

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

async function mount() {
  const { container } = await render(
    <GalleryVideoPlayer
      src="https://media.example/v.mp4"
      captions="/v.vtt"
      poster="/v.jpg"
      title="Skit"
      aspect={4 / 3}
    />
  );
  return container;
}

describe('GalleryVideoPlayer', () => {
  it('hands Video.js the video, captions, poster, and speed choices', async () => {
    const container = await mount();
    const video = container.querySelector('video')!;
    expect(video.getAttribute('src')).toBe('https://media.example/v.mp4');
    expect(video.getAttribute('aria-label')).toBe('Skit');
    expect(video.querySelector('track')!.getAttribute('src')).toBe('/v.vtt');
    expect(fake.playerProps).toMatchObject({ poster: '/v.jpg', defaultPlaybackRates: PLAYBACK_RATES });
    const skin = container.querySelector<HTMLElement>('.ecrs-player')!;
    expect(skin.style.getPropertyValue('--ecrs-aspect')).toBe(String(4 / 3));
  });

  describe('remembered speed', () => {
    it('restores the saved speed once the player attaches to the video', async () => {
      localStorage.setItem(RATE_KEY, '1.5');
      await mount();
      expect(fake.store.state.playbackRate).toBe(1); // actions would throw before attach
      await act(async () => fake.store.attach());
      expect(fake.store.state.playbackRate).toBe(1.5);
    });

    it('keeps waiting through state changes that come before the player attaches', async () => {
      localStorage.setItem(RATE_KEY, '1.25');
      await mount();
      await act(async () => fake.store.setPlaybackRate(1)); // e.g. metadata, still no target
      expect(fake.store.state.playbackRate).toBe(1);
      await act(async () => fake.store.attach());
      expect(fake.store.state.playbackRate).toBe(1.25);
    });

    it('restores only once even if the store notifies synchronously', async () => {
      localStorage.setItem(RATE_KEY, '1.5');
      fake.store.sync = true;
      await mount();
      await act(async () => fake.store.attach());
      expect(fake.store.state.playbackRate).toBe(1.5);
    });

    it('restores right away when the player is already attached', async () => {
      localStorage.setItem(RATE_KEY, '0.75');
      fake.store.target = {};
      await mount();
      expect(fake.store.state.playbackRate).toBe(0.75);
    });

    it('saves each change after the restore, but not the starting speed', async () => {
      await mount();
      expect(localStorage.getItem(RATE_KEY)).toBeNull();
      await act(async () => fake.store.attach());
      await act(async () => fake.store.setPlaybackRate(2));
      expect(localStorage.getItem(RATE_KEY)).toBe('2');
    });
  });

  describe('storage helpers', () => {
    it('accepts only speeds the menu offers', () => {
      localStorage.setItem(RATE_KEY, '7');
      expect(readSavedRate()).toBeUndefined();
      localStorage.setItem(RATE_KEY, '1.25');
      expect(readSavedRate()).toBe(1.25);
    });

    it('carries on when storage is blocked', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(readSavedRate()).toBeUndefined();
      expect(() => saveRate(1.5)).not.toThrow();
    });
  });
});

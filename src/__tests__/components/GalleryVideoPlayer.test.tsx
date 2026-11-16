// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import GalleryVideoPlayer, {
  liftCaptions,
  PLAYBACK_RATES,
  RATE_KEY,
  playOnOpen,
  readSavedRate,
  saveRate,
} from '~/components/widgets/GalleryVideoPlayer';
import { cleanup, render } from '../react';

// Video.js needs a real browser (e2e/gallery-video.spec.ts drives the real
// skin). Here the preset is a stand-in: plain elements plus a tiny store with
// the slice of the player API the component uses (target, playbackRate,
// paused, error, play, setPlaybackRate, dismissError, subscribe), so the tests
// cover the remembered speed, play on open, and stale-error clearing.
const fake = vi.hoisted(() => {
  interface State {
    playbackRate: number;
    paused: boolean;
    error: { code: number; message: string } | null;
  }
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
    state: { playbackRate: 1, paused: true, error: null } as State,
    dismissError: vi.fn(() => {
      store.state = { ...store.state, error: null };
      notify();
    }),
    /** Simulates the <video> reporting state (playing, an error). */
    set: (patch: Partial<State>) => {
      store.state = { ...store.state, ...patch };
      notify();
    },
    play: vi.fn(() => Promise.resolve()),
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
      store.play.mockClear();
      store.state = { playbackRate: 1, paused: true, error: null };
      store.dismissError.mockClear();
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
    expect(fake.playerProps).toMatchObject({ poster: '/v.jpg', title: 'Skit', defaultPlaybackRates: PLAYBACK_RATES });
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

  describe('error dialog', () => {
    const err = { code: 2, message: 'A network error caused the media download to fail.' };

    it('clears an error left over a video that is playing', async () => {
      await mount();
      await act(async () => fake.store.set({ error: err, paused: false }));
      expect(fake.store.dismissError).toHaveBeenCalled();
      expect(fake.store.state.error).toBeNull();
    });

    it('keeps the error showing when the video has stopped', async () => {
      await mount();
      await act(async () => fake.store.set({ error: err, paused: true }));
      expect(fake.store.dismissError).not.toHaveBeenCalled();
      expect(fake.store.state.error).toBe(err);
    });
  });

  describe('play on open', () => {
    it('starts the video whose tile was clicked, once, after it attaches', async () => {
      playOnOpen('https://media.example/v.mp4');
      await mount();
      expect(fake.store.play).not.toHaveBeenCalled();
      await act(async () => fake.store.attach());
      expect(fake.store.play).toHaveBeenCalledTimes(1);
      // The request is used up: reopening the same video by swiping doesn't play it.
      await cleanup();
      fake.store.reset();
      await mount();
      await act(async () => fake.store.attach());
      expect(fake.store.play).not.toHaveBeenCalled();
    });

    it('leaves other videos (neighboring slides) paused', async () => {
      playOnOpen('https://media.example/other.mp4');
      await mount();
      await act(async () => fake.store.attach());
      expect(fake.store.play).not.toHaveBeenCalled();
    });

    it('stays paused quietly when the browser blocks playback', async () => {
      fake.store.play.mockImplementationOnce(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')));
      playOnOpen('https://media.example/v.mp4');
      await mount();
      await act(async () => fake.store.attach());
      expect(fake.store.play).toHaveBeenCalledTimes(1);
    });
  });

  describe('captions above the control bar (Firefox)', () => {
    // A 400px-tall player whose Seek slider is centered 30px above its bottom,
    // so the bar plus margin takes 60px; Firefox needs 24px more.
    let cues: VTTCue[];
    function slide() {
      const el = document.createElement('div');
      el.innerHTML = '<div class="ecrs-player"><video><track></video><div role="slider" aria-label="Seek"></div></div>';
      const root = el.querySelector<HTMLElement>('.ecrs-player')!;
      const rect = (top: number, height: number) => ({ top, height, bottom: top + height }) as DOMRect;
      root.getBoundingClientRect = () => rect(0, 400);
      el.querySelector('[role="slider"]')!.getBoundingClientRect = () => rect(366, 8);
      cues = [{}, {}] as VTTCue[];
      Object.defineProperty(el.querySelector('video'), 'textTracks', { value: [{ cues }] });
      document.body.append(el);
      return { el, root };
    }
    const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

    beforeEach(() => {
      vi.stubGlobal('CSS', { supports: () => false });
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe = vi.fn();
          disconnect = vi.fn();
        }
      );
    });
    afterEach(() => vi.unstubAllGlobals());

    it('lifts cues above the bar while it shows, and drops them when it hides', async () => {
      const { el, root } = slide();
      root.setAttribute('data-controls-visible', '');
      const stop = liftCaptions(el);
      expect(cues[0]).toMatchObject({ snapToLines: false, lineAlign: 'end', line: 100 - (84 / 400) * 100 });
      root.removeAttribute('data-controls-visible');
      await flush();
      expect(cues[1]).toMatchObject({ snapToLines: true, line: 'auto' });
      stop();
    });

    it('places cues once the caption file loads', () => {
      const { el, root } = slide();
      root.setAttribute('data-controls-visible', '');
      const track = el.querySelector('video')!.textTracks[0] as { cues: VTTCue[] | null };
      track.cues = null;
      const stop = liftCaptions(el);
      track.cues = cues;
      el.querySelector('track')!.dispatchEvent(new Event('load'));
      expect(cues[0].line).toBe(79);
      stop();
    });

    it('never pushes captions above the middle of a tiny player', () => {
      const { el, root } = slide();
      root.setAttribute('data-controls-visible', '');
      root.getBoundingClientRect = () => ({ top: 300, height: 100, bottom: 400 }) as DOMRect;
      const stop = liftCaptions(el);
      expect(cues[0].line).toBe(50);
      stop();
    });

    it('leaves captions to the skin where it can lift them (Chrome, Safari)', () => {
      vi.stubGlobal('CSS', { supports: () => true });
      const { el, root } = slide();
      root.setAttribute('data-controls-visible', '');
      liftCaptions(el)();
      expect(cues[0]).toEqual({});
    });

    it('does nothing without a player in the slide', () => {
      expect(() => liftCaptions(document.createElement('div'))()).not.toThrow();
      expect(() => liftCaptions(null)()).not.toThrow();
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

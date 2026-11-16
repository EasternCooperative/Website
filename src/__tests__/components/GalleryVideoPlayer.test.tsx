// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import GalleryVideoPlayer, { PLAYBACK_RATES } from '~/components/widgets/GalleryVideoPlayer';
import { cleanup, render } from '../react';

// media-chrome's custom elements need a real browser (the e2e spec drives
// them). Here each wrapper renders as its plain tag, so the tests cover the
// player's own logic: the remembered speed and caption placement.
const { stubs } = vi.hoisted(() => ({
  stubs: async (names: Record<string, string>) => {
    const { createElement } = await import('react');
    const tag =
      (name: string) =>
      ({
        children,
        className,
        style,
        rates,
      }: {
        children?: ReactNode;
        className?: string;
        style?: object;
        rates?: number[];
      }) =>
        createElement(name, { class: className, style, 'data-rates': rates?.join(' ') }, children);
    return Object.fromEntries(Object.entries(names).map(([k, v]) => [k, tag(v)]));
  },
}));
vi.mock('media-chrome/react', () =>
  stubs({
    MediaCaptionsButton: 'media-captions-button',
    MediaControlBar: 'media-control-bar',
    MediaController: 'media-controller',
    MediaFullscreenButton: 'media-fullscreen-button',
    MediaLoadingIndicator: 'media-loading-indicator',
    MediaMuteButton: 'media-mute-button',
    MediaPipButton: 'media-pip-button',
    MediaPlayButton: 'media-play-button',
    MediaSeekBackwardButton: 'media-seek-backward-button',
    MediaSeekForwardButton: 'media-seek-forward-button',
    MediaTimeDisplay: 'media-time-display',
    MediaTimeRange: 'media-time-range',
    MediaVolumeRange: 'media-volume-range',
  })
);
vi.mock('media-chrome/react/menu', () =>
  stubs({
    MediaPlaybackRateMenu: 'media-playback-rate-menu',
    MediaPlaybackRateMenuButton: 'media-playback-rate-menu-button',
  })
);
vi.mock('~/assets/styles/gallery-video-player.css', () => ({}));

const RATE_KEY = 'ecrs-video-rate';
let cues: { line?: number; lineAlign?: string; snapToLines?: boolean }[];
let resizeDisconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  cues = [{}, {}];
  resizeDisconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = resizeDisconnect;
    }
  );
  // jsdom implements neither text tracks nor layout.
  Object.defineProperty(HTMLMediaElement.prototype, 'textTracks', {
    configurable: true,
    get: () => [{ cues }],
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
});

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLMediaElement.prototype as { textTracks?: unknown }).textTracks;
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
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
  return {
    container,
    video: container.querySelector('video')!,
    controller: container.querySelector('media-controller')!,
  };
}

describe('GalleryVideoPlayer', () => {
  it('renders the video, captions, poster, aspect, and speed choices', async () => {
    const { container, video, controller } = await mount();
    expect(video.getAttribute('poster')).toBe('/v.jpg');
    expect(video.getAttribute('aria-label')).toBe('Skit');
    expect(video.querySelector('source')!.getAttribute('src')).toBe('https://media.example/v.mp4');
    expect(video.querySelector('track')!.getAttribute('src')).toBe('/v.vtt');
    expect((controller as HTMLElement).style.getPropertyValue('--ecrs-aspect')).toBe(String(4 / 3));
    expect(container.querySelector('media-playback-rate-menu')!.getAttribute('data-rates')).toBe(
      PLAYBACK_RATES.join(' ')
    );
  });

  describe('remembered speed', () => {
    it('starts at the speed saved from an earlier video', async () => {
      localStorage.setItem(RATE_KEY, '1.5');
      const { video } = await mount();
      expect(video.playbackRate).toBe(1.5);
      expect(video.defaultPlaybackRate).toBe(1.5);
    });

    it('ignores a saved value that is not one of the menu speeds', async () => {
      localStorage.setItem(RATE_KEY, '7');
      const { video } = await mount();
      expect(video.playbackRate).toBe(1);
    });

    it('saves the speed whenever it changes', async () => {
      const { video } = await mount();
      video.playbackRate = 0.75;
      video.dispatchEvent(new Event('ratechange'));
      expect(localStorage.getItem(RATE_KEY)).toBe('0.75');
    });

    it('still plays when storage is blocked', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const { video } = await mount();
      expect(video.playbackRate).toBe(1);
      expect(() => video.dispatchEvent(new Event('ratechange'))).not.toThrow();
    });
  });

  describe('caption placement', () => {
    const settleObservers = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

    it('lifts captions above the controls while they show', async () => {
      await mount();
      // 400px player, 76px of controls: cue bottoms at 81% down.
      expect(cues).toEqual([
        { snapToLines: false, lineAlign: 'end', line: 81 },
        { snapToLines: false, lineAlign: 'end', line: 81 },
      ]);
    });

    it('drops captions down once the controls auto-hide during playback', async () => {
      const { controller } = await mount();
      controller.setAttribute('userinactive', '');
      await settleObservers();
      expect(cues[0].line).toBe(94);
      // Paused, the controls stay up even when the pointer is idle.
      controller.setAttribute('mediapaused', '');
      await settleObservers();
      expect(cues[0].line).toBe(81);
    });

    it('re-places cues once the caption file loads', async () => {
      cues = [];
      const { video } = await mount();
      cues.push({});
      video.querySelector('track')!.dispatchEvent(new Event('load'));
      expect(cues[0].line).toBe(81);
    });

    it('never pushes captions above the middle of a tiny player', async () => {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 100 });
      await mount();
      expect(cues[0].line).toBe(50);
    });

    it('stops listening when the slide unmounts', async () => {
      const { video } = await mount();
      await cleanup();
      expect(resizeDisconnect).toHaveBeenCalled();
      video.dispatchEvent(new Event('ratechange'));
      expect(localStorage.getItem(RATE_KEY)).toBeNull();
    });
  });
});

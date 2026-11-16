import { useEffect, useRef, useState } from 'react';
import { Video, VideoPlayer, VideoSkin, usePlayer } from '@videojs/react/video';
import '@videojs/react/video/skin.css';
import '~/assets/styles/gallery-video-player.css';

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

// Remembered across videos and visits, so someone who watches at 1.5x (or
// slowed down to catch the words of a song) doesn't have to reset it each time.
export const RATE_KEY = 'ecrs-video-rate';

export function readSavedRate(): number | undefined {
  try {
    const rate = Number(localStorage.getItem(RATE_KEY));
    return PLAYBACK_RATES.includes(rate) ? rate : undefined;
  } catch {
    return undefined;
  }
}

export function saveRate(rate: number) {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    /* storage blocked: the speed just won't be remembered */
  }
}

// Clicking a video's tile should start it, not just open the lightbox on a
// paused player. The tile records which video it opened; that player starts
// itself once it attaches. Swiping onto a video in the lightbox doesn't.
let pendingPlay: string | undefined;

/** Call from the tile's click, before opening the lightbox. */
export function playOnOpen(src: string) {
  pendingPlay = src;
}

/**
 * Once the player attaches to the <video>: restores the saved speed, then
 * saves every change, and starts playback if the tile click asked for it.
 * Follows Video.js's "Remember user preferences" guide: actions throw before
 * the store has a media target, so this waits for one.
 */
function PlayerSetup({ src }: { src: string }) {
  const store = usePlayer();
  const rate = usePlayer((s) => s.playbackRate);
  const [saved] = useState(readSavedRate);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) saveRate(rate);
  }, [rate]);

  useEffect(() => {
    const restore = () => {
      if (restored.current) return true;
      if (!store.target) return false;
      // Mark first: setPlaybackRate notifies subscribers, including this one.
      restored.current = true;
      if (saved) store.setPlaybackRate(saved);
      if (pendingPlay === src) {
        pendingPlay = undefined;
        // A browser that still blocks it leaves the big play button showing.
        store.play().catch(() => {});
      }
      return true;
    };
    if (restore()) return;
    const unsubscribe = store.subscribe(() => {
      if (restore()) unsubscribe();
    });
    return unsubscribe;
  }, [store, saved, src]);

  return null;
}

interface Props {
  src: string;
  captions: string;
  poster: string;
  title: string;
  /** Width / height of the video, so the player fits the slide without letterboxing. */
  aspect: number;
}

/**
 * Lightbox video player: Video.js 10's packaged video skin (play, seek, volume,
 * a settings menu with speed and captions, picture-in-picture, fullscreen, and
 * keyboard shortcuts while the player has focus), themed with ECRS pink.
 */
export default function GalleryVideoPlayer({ src, captions, poster, title, aspect }: Props) {
  return (
    <div className="ecrs-player-slide">
      <VideoPlayer poster={poster} defaultPlaybackRates={PLAYBACK_RATES}>
        <VideoSkin className="ecrs-player" style={{ '--ecrs-aspect': aspect } as React.CSSProperties}>
          <Video src={src} playsInline preload="metadata" aria-label={title}>
            <track kind="captions" src={captions} srcLang="en" label="English" default />
          </Video>
        </VideoSkin>
        <PlayerSetup src={src} />
      </VideoPlayer>
    </div>
  );
}

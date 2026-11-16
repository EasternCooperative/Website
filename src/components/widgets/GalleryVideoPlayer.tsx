import { useEffect, useRef } from 'react';
import {
  MediaCaptionsButton,
  MediaControlBar,
  MediaController,
  MediaFullscreenButton,
  MediaLoadingIndicator,
  MediaMuteButton,
  MediaPipButton,
  MediaPlayButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeRange,
} from 'media-chrome/react';
import { MediaPlaybackRateMenu, MediaPlaybackRateMenuButton } from 'media-chrome/react/menu';
import '~/assets/styles/gallery-video-player.css';

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

// Remembered across videos and visits, so someone who watches at 1.5x (or
// slowed down to catch the words of a song) doesn't have to reset it each time.
const RATE_KEY = 'ecrs-video-rate';

function readSavedRate(): number | undefined {
  try {
    const rate = Number(localStorage.getItem(RATE_KEY));
    return PLAYBACK_RATES.includes(rate) ? rate : undefined;
  } catch {
    return undefined;
  }
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
 * Lightbox video player: media-chrome controls around a native <video>, with
 * a speed menu, captions toggle, 10-second skips, picture-in-picture, and
 * fullscreen. Keyboard: space/k play, j/l or arrows seek, m mute, f fullscreen,
 * c captions, while the player has focus.
 */
export default function GalleryVideoPlayer({ src, captions, poster, title, aspect }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const saved = readSavedRate();
    if (saved) video.playbackRate = video.defaultPlaybackRate = saved;
    const saveRate = () => {
      try {
        localStorage.setItem(RATE_KEY, String(video.playbackRate));
      } catch {
        /* storage blocked: the speed just won't be remembered */
      }
    };
    video.addEventListener('ratechange', saveRate);

    // Native cues sit at the very bottom of the video, under media-chrome's
    // control bar. Lift them clear of it while the controls show, and let
    // them drop back down once the controls auto-hide during playback.
    const controller = video.closest('media-controller');
    const track = video.textTracks[0];
    const placeCues = () => {
      if (!controller || !track?.cues) return;
      const hidden = controller.hasAttribute('userinactive') && !controller.hasAttribute('mediapaused');
      const clearance = hidden ? 24 : 76; // px: control bar plus scrubber
      const line = Math.max(50, 100 - (clearance / Math.max(controller.clientHeight, 1)) * 100);
      for (const cue of Array.from(track.cues) as VTTCue[]) {
        cue.snapToLines = false;
        cue.lineAlign = 'end';
        cue.line = line;
      }
    };
    const trackEl = video.querySelector('track');
    trackEl?.addEventListener('load', placeCues);
    placeCues();
    const resize = new ResizeObserver(placeCues);
    const attrs = new MutationObserver(placeCues);
    if (controller) {
      resize.observe(controller);
      attrs.observe(controller, { attributes: true, attributeFilter: ['userinactive', 'mediapaused'] });
    }

    return () => {
      video.removeEventListener('ratechange', saveRate);
      trackEl?.removeEventListener('load', placeCues);
      resize.disconnect();
      attrs.disconnect();
    };
  }, []);

  return (
    <div className="ecrs-player-slide">
      <MediaController
        className="ecrs-player"
        defaultSubtitles
        aria-label={`Video: ${title}`}
        style={{ '--ecrs-aspect': aspect } as React.CSSProperties}
      >
        <video
          ref={videoRef}
          slot="media"
          playsInline
          preload="metadata"
          poster={poster}
          aria-label={title}
          suppressHydrationWarning
        >
          <source src={src} type="video/mp4" />
          <track kind="captions" src={captions} srcLang="en" label="English" default />
        </video>

        <MediaLoadingIndicator slot="centered-chrome" noAutohide />
        <MediaPlayButton slot="centered-chrome" className="ecrs-player__big-play" />

        <MediaPlaybackRateMenu hidden anchor="auto" rates={PLAYBACK_RATES} />

        <MediaTimeRange className="ecrs-player__range" />
        <MediaControlBar>
          <MediaPlayButton />
          <MediaSeekBackwardButton seekOffset={10} className="ecrs-player__wide" />
          <MediaSeekForwardButton seekOffset={10} className="ecrs-player__wide" />
          <MediaMuteButton />
          <MediaVolumeRange className="ecrs-player__wide" />
          <MediaTimeDisplay showDuration />
          <span className="ecrs-player__spacer" />
          <MediaPlaybackRateMenuButton aria-label="Playback speed" />
          <MediaCaptionsButton />
          <MediaPipButton className="ecrs-player__wide" />
          <MediaFullscreenButton />
        </MediaControlBar>
      </MediaController>
    </div>
  );
}

function applyHeaderOffset(
  header: HTMLElement,
  section: HTMLElement,
  content: HTMLElement | null,
  badge: HTMLElement | null
) {
  const h = header.getBoundingClientRect().height;
  section.style.marginTop = `-${h}px`;
  if (content) content.style.paddingTop = `${h + 32}px`;
  if (badge) badge.style.top = `${h + 12}px`;
}

function initVideoHero() {
  const header = document.querySelector<HTMLElement>('#header');
  const section = document.querySelector<HTMLElement>('[data-video-hero]');
  const content = document.querySelector<HTMLElement>('[data-video-hero-content]');

  if (!section) return;

  if (header) {
    const badge = section.querySelector<HTMLElement>('[data-hero-badge]');
    applyHeaderOffset(header, section, content, badge);
    const resizeController = new AbortController();
    window.addEventListener('resize', () => applyHeaderOffset(header, section, content, badge), {
      signal: resizeController.signal,
    });
    document.addEventListener('astro:before-preparation', () => resizeController.abort(), { once: true });
  }

  const videos = [...document.querySelectorAll<HTMLVideoElement>('[data-hero-video]')];
  const toggleBtn = document.querySelector<HTMLButtonElement>('[data-video-toggle]');
  const pauseIcon = toggleBtn?.querySelector<SVGElement>('[data-icon-pause]');
  const playIcon = toggleBtn?.querySelector<SVGElement>('[data-icon-play]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let isPlaying = false;

  // Icon reflects user intent (`isPlaying`), not raw per-video pause/play events — the
  // crossfade pauses the outgoing clip and plays the incoming one internally on every
  // transition, which isn't a play/pause the user asked for.
  function syncIcon(playing: boolean) {
    if (pauseIcon) pauseIcon.classList.toggle('hidden', !playing);
    if (playIcon) playIcon.classList.toggle('hidden', playing);
  }

  // Auto-pause once the video(s) have cycled through twice, or after 5 minutes,
  // whichever comes first — intentional behavior, not a stall. A manual replay
  // via the toggle button afterward is not subject to the limit again.
  let cycleCount = 0;
  let autoStopped = false;
  const startTime = Date.now();
  const MAX_CYCLES = 2;
  const MAX_MS = 5 * 60 * 1000;

  function maybeAutoStop(activeVideo: HTMLVideoElement): boolean {
    if (autoStopped) return false;
    if (cycleCount < MAX_CYCLES && Date.now() - startTime < MAX_MS) return false;
    autoStopped = true;
    activeVideo.currentTime = 0;
    setPaused(true);
    return true;
  }

  function setPaused(paused: boolean) {
    isPlaying = !paused;
    videos.forEach((v) => (paused ? v.pause() : v.play().catch(() => {})));
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-label', paused ? 'Play background video' : 'Pause background video');
    }
    syncIcon(!paused);
    // Hide button when no motion to toggle
    if (toggleBtn) toggleBtn.style.display = reducedMotion ? 'none' : '';
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => setPaused(isPlaying));
  }

  if (!reducedMotion) {
    if (videos.length > 1) {
      let current = 0;
      let transitioning = false;
      let queued: number | null = null;

      function crossfadeTo(nextIndex: number) {
        if (nextIndex === current) return;
        if (transitioning) {
          queued = nextIndex;
          return;
        }
        transitioning = true;

        const prev = videos[current];
        const next = videos[nextIndex];

        videos[(nextIndex + 1) % videos.length].preload = 'auto';

        next.currentTime = 0;
        next.play().catch(() => {});
        next.style.opacity = '1';
        prev.style.opacity = '0';

        setTimeout(() => {
          prev.pause();
          prev.currentTime = 0;
          current = nextIndex;
          transitioning = false;
          if (queued !== null) {
            const q = queued;
            queued = null;
            crossfadeTo(q);
          }
        }, 2100);
      }

      videos.forEach((video, i) => {
        video.addEventListener('ended', () => {
          if (!isPlaying) return;
          const nextIndex = (i + 1) % videos.length;
          if (nextIndex === 0) cycleCount++;
          if (maybeAutoStop(video)) return;
          crossfadeTo(nextIndex);
        });
      });

      // Defer preloading subsequent videos until 5 seconds remain in the current
      // clip — enough runway even on slow mobile, without an upfront 2 MB download.
      const preloadNext = (afterIndex: number) => {
        const next = videos[(afterIndex + 1) % videos.length];
        if (next && next.preload !== 'auto') next.preload = 'auto';
      };
      videos[0]?.addEventListener('timeupdate', function onProgress(this: HTMLVideoElement) {
        if (this.duration && this.duration - this.currentTime <= 5) {
          preloadNext(0);
          this.removeEventListener('timeupdate', onProgress);
        }
      });
      // The icon's default markup already shows "pause" (assumes autoplay succeeds).
      // Only correct it if the browser actually blocks autoplay.
      videos[0]?.play().catch(() => {
        isPlaying = false;
        syncIcon(false);
      });
      isPlaying = true;
    } else if (videos.length === 1) {
      const v = videos[0];
      v.addEventListener('ended', () => {
        if (!isPlaying) return;
        cycleCount++;
        if (maybeAutoStop(v)) return;
        v.currentTime = 0;
        v.play().catch(() => {});
      });
      // The icon's default markup already shows "pause" (assumes autoplay succeeds).
      // Only correct it if the browser actually blocks autoplay.
      v.play().catch(() => {
        isPlaying = false;
        syncIcon(false);
      });
      isPlaying = true;
    }
  } else {
    // Pause the HTML autoplay and hide the toggle (no motion to toggle).
    videos[0]?.pause();
    if (toggleBtn) toggleBtn.style.display = 'none';
  }
}

function initCountdown() {
  const el = document.querySelector<HTMLElement>('[data-countdown]');
  if (!el) return;

  const target = new Date(el.dataset.countdown!).getTime();

  // Cache the value <span>s so a normal tick only touches text nodes.
  // A full rebuild only happens when the set of labels changes (e.g. "days/hrs" → "hrs/min/sec").
  let currentLabels: string[] | null = null;
  let valueEls: HTMLElement[] = [];

  function unit(label: string) {
    const wrapper = document.createElement('div');
    wrapper.className = 'text-center';
    const value = document.createElement('span');
    value.className = 'font-mono text-3xl font-bold text-white leading-none';
    const labelEl = document.createElement('span');
    labelEl.className = 'block text-xs text-white/70 uppercase tracking-widest mt-1';
    labelEl.textContent = label;
    wrapper.append(value, labelEl);
    return { wrapper, value };
  }

  function computeUnits(diff: number): { value: string; label: string }[] {
    const totalDays = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    const seconds = Math.floor((diff % 60_000) / 1_000);

    if (totalDays >= 365) {
      const years = Math.floor(totalDays / 365);
      const months = Math.floor((totalDays % 365) / 30);
      return [
        { value: String(years), label: years === 1 ? 'year' : 'years' },
        { value: String(months), label: 'mo' },
      ];
    } else if (totalDays >= 30) {
      const months = Math.floor(totalDays / 30);
      const days = totalDays % 30;
      return [
        { value: String(months), label: months === 1 ? 'month' : 'months' },
        { value: String(days), label: 'days' },
      ];
    } else if (totalDays >= 1) {
      return [
        { value: String(totalDays), label: totalDays === 1 ? 'day' : 'days' },
        { value: String(hours), label: 'hrs' },
      ];
    }
    return [
      { value: String(hours).padStart(2, '0'), label: 'hrs' },
      { value: String(minutes).padStart(2, '0'), label: 'min' },
      { value: String(seconds).padStart(2, '0'), label: 'sec' },
    ];
  }

  function render(diff: number) {
    const units = computeUnits(diff);
    const labels = units.map((u) => u.label);

    if (!currentLabels || labels.join() !== currentLabels.join()) {
      const row = document.createElement('div');
      row.className = 'flex gap-4 items-start';
      valueEls = units.map(({ label }) => {
        const { wrapper, value } = unit(label);
        row.append(wrapper);
        return value;
      });
      el!.replaceChildren(row);
      currentLabels = labels;
    }

    units.forEach(({ value }, i) => {
      if (valueEls[i].textContent !== value) valueEls[i].textContent = value;
    });
  }

  function tick() {
    const diff = target - Date.now();
    if (diff <= 0) {
      el!.hidden = true;
      clearInterval(intervalId);
      return;
    }
    render(diff);
  }

  tick();
  const intervalId = setInterval(tick, 1000);
  document.addEventListener('astro:before-preparation', () => clearInterval(intervalId), { once: true });
}

export function initVideoHeroPage(): void {
  document.addEventListener('astro:page-load', () => {
    initVideoHero();
    initCountdown();
  });
}

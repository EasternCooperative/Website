function initLeaderPopovers() {
  document.querySelectorAll<HTMLButtonElement>('[data-popover-target]').forEach((btn) => {
    const pop = document.getElementById(btn.dataset.popoverTarget!);
    if (!pop) return;
    let hideTimer: ReturnType<typeof setTimeout>;

    function position() {
      const rect = btn.getBoundingClientRect();
      const card = pop!.querySelector('div')!;
      const margin = 8;
      let left = rect.left;
      let top = rect.bottom + margin;
      if (left + card.offsetWidth > window.innerWidth - margin) left = window.innerWidth - card.offsetWidth - margin;
      if (left < margin) left = margin;
      if (top + card.offsetHeight > window.innerHeight - margin) top = rect.top - card.offsetHeight - margin;
      pop!.style.position = 'fixed';
      pop!.style.left = left + 'px';
      pop!.style.top = top + 'px';
    }

    function show() {
      clearTimeout(hideTimer);
      if (!pop!.matches(':popover-open')) {
        pop!.showPopover();
        position();
        btn.setAttribute('aria-expanded', 'true');
      }
    }

    function hide() {
      hideTimer = setTimeout(() => {
        if (pop!.matches(':popover-open')) {
          pop!.hidePopover();
          btn.setAttribute('aria-expanded', 'false');
        }
      }, 120);
    }

    btn.addEventListener('mouseenter', show);
    btn.addEventListener('mouseleave', hide);
    // Click always shows; outside-click auto-dismisses via popover="auto"
    btn.addEventListener('click', () => show());
    pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    pop.addEventListener('mouseleave', hide);
  });
}

function initShareButton() {
  // Delegated on document (not bound to the button directly) so it keeps working
  // after Astro view-transition navigations swap in a fresh #share-btn element.
  document.addEventListener('click', async (e) => {
    const shareBtn = (e.target as Element).closest('#share-btn') as HTMLButtonElement | null;
    if (!shareBtn) return;
    const { title, text } = shareBtn.dataset;
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title, text, url });
    } else {
      await navigator.clipboard.writeText(url);
      const originalHTML = shareBtn.innerHTML;
      shareBtn.innerHTML = '<span class="text-sm font-semibold px-1">Copied!</span>';
      setTimeout(() => (shareBtn.innerHTML = originalHTML), 2000);
    }
  });
}

function initMapsFallback() {
  // On mobile, geo: triggers the system app chooser (Google Maps, Waze, Apple Maps, etc.).
  // On desktop, geo: does nothing, so fall back to maps.apple.com which works in any browser.
  document.addEventListener('click', (e) => {
    const link = (e.target as Element).closest('a[data-maps-fallback]') as HTMLAnchorElement | null;
    if (!link) return;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile) {
      e.preventDefault();
      window.open(link.dataset.mapsFallback, '_blank', 'noopener,noreferrer');
    }
  });
}

export function initEventPageInteractions(): void {
  initLeaderPopovers();
  document.addEventListener('astro:page-load', initLeaderPopovers);
  initShareButton();
  initMapsFallback();
}

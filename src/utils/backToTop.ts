const SHOW_AFTER_PX = 400;
// A page only counts as "long" — and gets the button at all — once its total
// height is a good multiple of the viewport. Short pages (contact, donate)
// never scroll far enough for a jump-to-top to be useful even after scrolling
// past SHOW_AFTER_PX, so this is checked live rather than hardcoded per-page.
const LONG_PAGE_VIEWPORT_MULTIPLIER = 2.5;

function isLongPage(): boolean {
  return document.documentElement.scrollHeight > window.innerHeight * LONG_PAGE_VIEWPORT_MULTIPLIER;
}

function initBackToTop() {
  const button = document.querySelector<HTMLButtonElement>('[data-back-to-top]');
  if (!button) return;
  // Same double-fire guard as peopleFilters.ts — astro:page-load fires even on
  // the very first load, in addition to the direct call below.
  if (button.dataset.backToTopInitialized === 'true') return;
  button.dataset.backToTopInitialized = 'true';

  function updateVisibility() {
    const visible = isLongPage() && window.scrollY > SHOW_AFTER_PX;
    button!.classList.toggle('opacity-0', !visible);
    button!.classList.toggle('pointer-events-none', !visible);
  }

  window.addEventListener('scroll', updateVisibility, { passive: true });
  // Page height can change after load (images, fonts, dynamic content), so
  // re-check on resize too rather than only computing isLongPage() once.
  window.addEventListener('resize', updateVisibility, { passive: true });
  updateVisibility();

  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Drop any #section-... fragment so the URL stops pointing at a spot the
    // reader just scrolled away from.
    history.replaceState(null, '', window.location.pathname + window.location.search);
  });
}

export function initBackToTopPage(): void {
  initBackToTop();
  document.addEventListener('astro:page-load', initBackToTop);
}

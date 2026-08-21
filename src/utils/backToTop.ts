const SHOW_AFTER_PX = 400;

function initBackToTop() {
  const button = document.querySelector<HTMLButtonElement>('[data-back-to-top]');
  if (!button) return;
  // Same double-fire guard as peopleFilters.ts — astro:page-load fires even on
  // the very first load, in addition to the direct call below.
  if (button.dataset.backToTopInitialized === 'true') return;
  button.dataset.backToTopInitialized = 'true';

  function updateVisibility() {
    const visible = window.scrollY > SHOW_AFTER_PX;
    button!.classList.toggle('opacity-0', !visible);
    button!.classList.toggle('pointer-events-none', !visible);
  }

  window.addEventListener('scroll', updateVisibility, { passive: true });
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

/**
 * Of Play and Playfulness: the chapter sidebar's show/hide buttons. Each
 * `[data-opp-toggle]` button controls the section list named by its
 * aria-controls. One listener on the document, so it keeps working after
 * view-transition navigation swaps the sidebar out (page scripts don't re-run).
 */
let initialized = false;

export function toggleSections(button: HTMLElement): void {
  const list = document.getElementById(button.getAttribute('aria-controls') ?? '');
  if (!list) return;
  const expand = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(expand));
  list.hidden = !expand;
}

export function initBookSidebar(): void {
  if (initialized) return;
  initialized = true;
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>('[data-opp-toggle]');
    if (button) toggleSections(button);
  });
}

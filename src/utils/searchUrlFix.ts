// Pagefind derives result URLs from the dist/<page>/index.html file path, so
// it emits trailing-slash URLs (e.g. "/our-people/"). The site runs
// trailingSlash: 'never' and links slash-less everywhere else (navigation.json,
// permalinks.ts), so those URLs trigger Astro's redirect interstitial. Rewrite
// result hrefs (which render live as the user types) to the slash-less form the
// rest of the site already uses. Editing the href attribute also covers
// middle-click / cmd-click / open-in-new-tab, which a click handler would miss.
function normalizeHref(a: Element) {
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/')) return;
  const match = href.match(/^([^?#]*)(.*)$/);
  if (!match) return;
  let path = match[1];
  const rest = match[2];
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
    a.setAttribute('href', path + rest);
  }
}

const observers = new WeakMap<Element, MutationObserver>();

function initSearchUrlFix() {
  document.querySelectorAll('pagefind-modal, pagefind-results').forEach((container) => {
    if (observers.has(container)) return;
    container.querySelectorAll('a[href]').forEach(normalizeHref);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('a[href]')) normalizeHref(node);
          node.querySelectorAll('a[href]').forEach(normalizeHref);
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true });
    observers.set(container, observer);
  });
}

// Pagefind's instance manager adds components on every connectedCallback but
// never removes them on disconnectedCallback. After each View Transitions swap
// the old pagefind-modal/trigger elements are disconnected but remain in the
// registry; openModal() always calls modals[0] which is then the stale
// disconnected original, causing a silent no-op. Scrub the registry after
// every swap so only the newly-connected elements remain.
function purgeStaleComponents() {
  const modal = document.querySelector('pagefind-modal');
  if (!modal) return;
  const inst = (modal as unknown as Record<string, unknown>).instance as
    { components?: unknown[]; componentsByType?: Record<string, unknown[]> } | undefined;
  if (!inst) return;
  const alive = (c: unknown) => c instanceof Element && c.isConnected;
  if (Array.isArray(inst.components)) inst.components = inst.components.filter(alive);
  if (inst.componentsByType) {
    for (const type of Object.keys(inst.componentsByType)) {
      inst.componentsByType[type] = inst.componentsByType[type].filter(alive);
    }
  }
}

// Close the modal when the user clicks any result link, including links that
// point to the current page (anchors, same-URL). Those don't trigger a View
// Transitions swap, so the modal would otherwise stay open.
function initModalCloseOnResult() {
  document.querySelectorAll('pagefind-modal').forEach((modal) => {
    if ((modal as unknown as Record<string, unknown>).__resultCloseInit) return;
    (modal as unknown as Record<string, unknown>).__resultCloseInit = true;
    modal.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('a[href]')) {
        (modal as unknown as { close?: () => void }).close?.();
      }
    });
  });
}

export function initPagefindFixes(): void {
  initSearchUrlFix();
  initModalCloseOnResult();
  document.addEventListener('astro:after-swap', () => {
    purgeStaleComponents();
    initSearchUrlFix();
    initModalCloseOnResult();
  });
}

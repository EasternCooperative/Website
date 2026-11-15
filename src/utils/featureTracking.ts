// Feature usage tracking: counts how often people use the site's interactive
// features (search, filters, share, calendar downloads, theme toggle, gallery).
//
// Everything is delegated on `document` from one module script that runs once
// per full page load, so it keeps working after View Transition swaps without
// any per-page wiring. Each event goes through `window.ecrsTrack`
// (src/components/common/EventTracker.astro), which forwards to GA4 only when
// gtag is loaded, so the consent banner still decides whether anything is sent.
//
// Document listeners run in the bubble phase, after the handlers bound directly
// on each control, so state such as `aria-pressed` or the dark-mode class has
// already been updated by the time we read it.

type Params = Record<string, string | number>;

declare global {
  interface Window {
    ecrsTrack?: (eventName: string, params?: Params) => void;
    gtag?: (...args: unknown[]) => void;
  }
}

function track(eventName: string, params?: Params): void {
  window.ecrsTrack?.(eventName, params);
}

// GA4's terms forbid sending personal data. Search boxes are free text, so
// drop anything that looks like an email address or a phone number.
export function sanitizeSearchTerm(raw: string): string | null {
  const term = raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 100);
  if (term.length < 2) return null;
  if (term.includes('@')) return null;
  if ((term.match(/\d/g) ?? []).length >= 7) return null;
  return term;
}

// Links whose clicks say something a page view doesn't. Pages such as
// /events/<id>/schedule already show up as page views, so they're left out.
export function classifyLink(pathname: string): { event: string; params: Params } | null {
  let m = pathname.match(/^\/events\/([^/]+)\.ics$/);
  if (m) return { event: 'add_to_calendar', params: { event_id: m[1] } };
  m = pathname.match(/^\/events\/([^/]+)\.txt$/);
  if (m) return { event: 'event_details_download', params: { event_id: m[1] } };
  m = pathname.match(/^\/events\/([^/]+)\/class-descriptions\.pdf$/);
  if (m) return { event: 'class_descriptions_download', params: { event_id: m[1] } };
  m = pathname.match(/^\/schedules\/([^/]+)\.pdf$/);
  if (m) return { event: 'schedule_pdf_download', params: { event_id: m[1] } };
  return null;
}

// Which filter event a page's controls report under.
export function filterEventForPath(pathname: string): string | null {
  if (pathname.startsWith('/activities')) return 'activity_filter';
  if (pathname.startsWith('/gallery')) return 'gallery_filter';
  if (pathname.startsWith('/events')) return 'past_events_filter';
  return null;
}

const ACTIVITY_CHIPS: Array<[string, string]> = [
  ['filterType', 'type'],
  ['filterPosture', 'posture'],
  ['filterMeter', 'meter'],
  ['filterKey', 'key'],
  ['filterTag', 'tag'],
];

function pressedState(el: Element): string {
  return el.getAttribute('aria-pressed') === 'true' ? 'on' : 'off';
}

function handleClick(e: MouseEvent): void {
  const target = e.target;
  if (!(target instanceof Element)) return;

  const link = target.closest('a[href]') as HTMLAnchorElement | null;
  if (link) {
    if (link.closest('pagefind-modal')) {
      flushSearch('site');
      track('search_result_click', {
        search_term: lastSent.get('site') ?? '',
        search_result_path: new URL(link.href, location.href).pathname,
      });
      return;
    }
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin) {
      const hit = classifyLink(url.pathname);
      if (hit) track(hit.event, hit.params);
    }
    return;
  }

  const button = target.closest('button') as HTMLButtonElement | null;
  if (!button) return;

  for (const [key, name] of ACTIVITY_CHIPS) {
    const value = button.dataset[key];
    if (value !== undefined) {
      track('activity_filter', { filter_name: name, filter_value: value, filter_state: pressedState(button) });
      return;
    }
  }

  if (button.id === 'filter-wheelchair-adaptable') {
    track('activity_filter', {
      filter_name: 'wheelchair_adaptable',
      filter_value: 'yes',
      filter_state: pressedState(button),
    });
  } else if (button.id === 'clear-all-filters') {
    track('activity_filters_clear');
  } else if (button.dataset.filterSite !== undefined) {
    track('past_events_filter', {
      filter_name: 'site',
      filter_value: button.dataset.filterSite,
      filter_state: pressedState(button),
    });
  } else if (button.id === 'clear-past-filters') {
    track('past_events_filters_clear');
  } else if (button.dataset.peopleSort !== undefined) {
    track('people_sort', { sort_order: button.dataset.peopleSort });
  } else if (button.id === 'people-filter-name-only') {
    track('people_filter', { filter_name: 'empty_profiles', filter_state: pressedState(button) });
  } else if (button.hasAttribute('data-aw-toggle-color-scheme')) {
    track('theme_toggle', { theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light' });
  }
}

// Fires when a range thumb is released or a <select> changes value.
function handleChange(e: Event): void {
  const target = e.target;
  if (target instanceof HTMLInputElement && target.type === 'range') {
    const event = filterEventForPath(location.pathname);
    const inputs = target.parentElement?.querySelectorAll<HTMLInputElement>('input[type="range"]');
    if (!event || !inputs || inputs.length !== 2) return;
    const name = (inputs[0].getAttribute('aria-label') ?? 'range')
      .replace(/^(minimum|earliest)\s+/i, '')
      .toLowerCase()
      .replace(/\s+/g, '_');
    track(event, { filter_name: name, filter_value: `${inputs[0].value}-${inputs[1].value}` });
  } else if (target instanceof HTMLSelectElement && target.dataset.trackFilter) {
    track('gallery_filter', { filter_name: target.dataset.trackFilter, filter_value: target.value || 'all' });
  }
}

// Search boxes update results on every keystroke, so wait until typing pauses
// and count the settled term once instead of every prefix of it.
const SEARCH_SETTLE_MS = 1500;
const pending = new Map<string, { term: string; timer: ReturnType<typeof setTimeout> }>();
const lastSent = new Map<string, string>();

function sendSearch(where: string, term: string): void {
  if (lastSent.get(where) === term) return;
  track('search', { search_term: term, search_location: where });
  // Only remember terms GA actually received. A search typed before the
  // visitor accepted the consent banner was dropped, so the same search after
  // accepting has to count.
  if (window.gtag) lastSent.set(where, term);
}

function flushSearch(where: string): void {
  const p = pending.get(where);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(where);
  sendSearch(where, p.term);
}

function searchLocationFor(input: HTMLInputElement): string | null {
  if (input.closest('pagefind-modal')) return 'site';
  return input.dataset.trackSearch ?? null;
}

function handleInput(e: Event): void {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || input.type === 'range') return;
  const where = searchLocationFor(input);
  if (!where) return;
  const prev = pending.get(where);
  if (prev) clearTimeout(prev.timer);
  const term = sanitizeSearchTerm(input.value);
  if (!term) {
    pending.delete(where);
    return;
  }
  pending.set(where, { term, timer: setTimeout(() => flushSearch(where), SEARCH_SETTLE_MS) });
}

let initialized = false;

export function initFeatureTracking(): void {
  if (initialized) return;
  initialized = true;
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  document.addEventListener('input', handleInput);
  // Don't lose a search typed just before leaving the page.
  document.addEventListener('astro:before-preparation', () => pending.forEach((_, where) => flushSearch(where)));
  window.addEventListener('pagehide', () => pending.forEach((_, where) => flushSearch(where)));
}

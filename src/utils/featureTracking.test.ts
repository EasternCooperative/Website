// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sanitizeSearchTerm, classifyLink, filterEventForPath } from './featureTracking';

describe('sanitizeSearchTerm', () => {
  it('normalizes case and whitespace', () => {
    expect(sanitizeSearchTerm('  Contra   DANCE ')).toBe('contra dance');
  });
  it('drops terms that are too short', () => {
    expect(sanitizeSearchTerm(' a ')).toBeNull();
  });
  it('drops anything that looks like an email or phone number', () => {
    expect(sanitizeSearchTerm('someone@example.com')).toBeNull();
    expect(sanitizeSearchTerm('555 123 4567')).toBeNull();
    expect(sanitizeSearchTerm('2026 camp')).toBe('2026 camp');
  });
  it('caps length at 100 characters', () => {
    expect(sanitizeSearchTerm('x'.repeat(150))).toHaveLength(100);
  });
});

describe('classifyLink', () => {
  it('recognizes event downloads', () => {
    expect(classifyLink('/events/wa-2026.ics')).toEqual({ event: 'add_to_calendar', params: { event_id: 'wa-2026' } });
    expect(classifyLink('/events/wa-2026.txt')?.event).toBe('event_details_download');
    expect(classifyLink('/events/wa-2026/class-descriptions.pdf')?.event).toBe('class_descriptions_download');
    expect(classifyLink('/schedules/wa-2026.pdf')?.event).toBe('schedule_pdf_download');
  });
  it('ignores ordinary pages', () => {
    expect(classifyLink('/events/wa-2026')).toBeNull();
    expect(classifyLink('/events/wa-2026/schedule')).toBeNull();
  });
});

describe('filterEventForPath', () => {
  it('maps pages to their filter event', () => {
    expect(filterEventForPath('/activities')).toBe('activity_filter');
    expect(filterEventForPath('/gallery')).toBe('gallery_filter');
    expect(filterEventForPath('/events')).toBe('past_events_filter');
    expect(filterEventForPath('/about')).toBeNull();
  });
});

describe('initFeatureTracking', () => {
  let track: ReturnType<typeof vi.fn<(eventName: string, params?: Record<string, string | number>) => void>>;
  const listeners: [string, EventListener][] = [];

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = '';
    track = vi.fn<(eventName: string, params?: Record<string, string | number>) => void>();
    window.ecrsTrack = track;
    // GA loaded (the visitor is measured) unless a test says otherwise.
    window.gtag = vi.fn();
    const original = document.addEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      listeners.push([type, listener as EventListener]);
      return original(type, listener, options);
    });
    const mod = await import('./featureTracking');
    mod.initFeatureTracking();
  });

  afterEach(() => {
    for (const [type, listener] of listeners.splice(0)) document.removeEventListener(type, listener);
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete window.ecrsTrack;
    delete window.gtag;
  });

  it('reports a filter chip with its new pressed state', () => {
    document.body.innerHTML = '<button data-filter-tag="circle" aria-pressed="true">Circle</button>';
    document.querySelector('button')!.click();
    expect(track).toHaveBeenCalledWith('activity_filter', {
      filter_name: 'tag',
      filter_value: 'circle',
      filter_state: 'on',
    });
  });

  it('reports calendar downloads from link clicks', () => {
    document.body.innerHTML = '<a href="/events/wa-2026.ics">Add</a>';
    const link = document.querySelector('a')!;
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    expect(track).toHaveBeenCalledWith('add_to_calendar', { event_id: 'wa-2026' });
  });

  it('sends one search event once typing settles', () => {
    document.body.innerHTML = '<input data-track-search="activities" />';
    const input = document.querySelector('input')!;
    for (const value of ['c', 'ci', 'cir', 'circle']) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(200);
    }
    expect(track).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('search', { search_term: 'circle', search_location: 'activities' });
  });

  it('ignores inputs that are not search boxes', () => {
    document.body.innerHTML = '<input />';
    const input = document.querySelector('input')!;
    input.value = 'hello';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(5000);
    expect(track).not.toHaveBeenCalled();
  });

  it('reports a range filter once released, named without its min prefix', () => {
    window.history.replaceState({}, '', '/events');
    document.body.innerHTML =
      '<div><input type="range" aria-label="Earliest year" min="2000" max="2026" value="2019" />' +
      '<input type="range" aria-label="Latest year" min="2000" max="2026" value="2026" /></div>';
    document.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(track).toHaveBeenCalledWith('past_events_filter', { filter_name: 'year', filter_value: '2019-2026' });
  });

  function click(html: string) {
    document.body.innerHTML = html;
    (document.body.firstElementChild as HTMLElement).click();
  }

  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it.each([
    [
      '<button id="filter-wheelchair-adaptable" aria-pressed="true"></button>',
      'activity_filter',
      { filter_name: 'wheelchair_adaptable', filter_value: 'yes', filter_state: 'on' },
    ],
    ['<button id="clear-all-filters"></button>', 'activity_filters_clear', undefined],
    [
      '<button data-filter-site="Wilmington" aria-pressed="false"></button>',
      'past_events_filter',
      { filter_name: 'site', filter_value: 'Wilmington', filter_state: 'off' },
    ],
    ['<button id="clear-past-filters"></button>', 'past_events_filters_clear', undefined],
    ['<button data-people-sort="za"></button>', 'people_sort', { sort_order: 'za' }],
    [
      '<button id="people-filter-name-only" aria-pressed="true"></button>',
      'people_filter',
      { filter_name: 'empty_profiles', filter_state: 'on' },
    ],
  ])('reports button %s', (html, event, params) => {
    click(html);
    expect(track).toHaveBeenCalledWith(event, params);
  });

  it('reports the theme the toggle switched to', () => {
    click('<button data-aw-toggle-color-scheme></button>');
    expect(track).toHaveBeenLastCalledWith('theme_toggle', { theme: 'light' });
    document.documentElement.classList.add('dark');
    (document.querySelector('button') as HTMLElement).click();
    expect(track).toHaveBeenLastCalledWith('theme_toggle', { theme: 'dark' });
    document.documentElement.classList.remove('dark');
  });

  it('ignores unrelated buttons, plain links, off-site links, and non-element targets', () => {
    click('<button>Other</button>');
    click('<div>Not a control</div>');
    document.body.innerHTML = '<a href="/about">About</a><a href="https://example.com/events/x.ics">Ext</a>';
    for (const a of document.querySelectorAll('a')) {
      a.addEventListener('click', (e) => e.preventDefault());
      a.click();
    }
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(track).not.toHaveBeenCalled();
  });

  it('reports a search result click with the pending search flushed first', () => {
    document.body.innerHTML = '<pagefind-modal><input /><a href="/membership?x=1#top">Membership</a></pagefind-modal>';
    type(document.querySelector('input')!, 'Membership');
    const link = document.querySelector('a')!;
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    expect(track.mock.calls).toEqual([
      ['search', { search_term: 'membership', search_location: 'site' }],
      ['search_result_click', { search_term: 'membership', search_result_path: '/membership' }],
    ]);
  });

  it('reports a result click with an empty term when nothing was searched', () => {
    document.body.innerHTML = '<pagefind-modal><a href="/about">About</a></pagefind-modal>';
    const link = document.querySelector('a')!;
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    expect(track).toHaveBeenCalledWith('search_result_click', { search_term: '', search_result_path: '/about' });
  });

  it('reports gallery selects, using "all" for the empty option', () => {
    document.body.innerHTML =
      '<select data-track-filter="photographer"><option value="">All</option><option value="Ann">Ann</option></select>';
    const select = document.querySelector('select')!;
    select.value = 'Ann';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(track.mock.calls).toEqual([
      ['gallery_filter', { filter_name: 'photographer', filter_value: 'Ann' }],
      ['gallery_filter', { filter_name: 'photographer', filter_value: 'all' }],
    ]);
  });

  it('ignores untagged selects, lone range inputs, and sliders on pages without filters', () => {
    document.body.innerHTML = '<select><option>a</option></select><div><input type="range" /></div>';
    document.querySelector('select')!.dispatchEvent(new Event('change', { bubbles: true }));
    window.history.replaceState({}, '', '/activities');
    document.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true }));
    window.history.replaceState({}, '', '/about');
    document.body.innerHTML = '<div><input type="range" /><input type="range" /></div>';
    document.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(track).not.toHaveBeenCalled();
  });

  it('names an unlabeled slider "range"', () => {
    window.history.replaceState({}, '', '/gallery');
    document.body.innerHTML = '<div><input type="range" value="1" /><input type="range" value="9" /></div>';
    document.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(track).toHaveBeenCalledWith('gallery_filter', { filter_name: 'range', filter_value: '1-9' });
  });

  it('does not resend the same term, and drops a search cleared before it settles', () => {
    document.body.innerHTML = '<input data-track-search="gallery" />';
    const input = document.querySelector('input')!;
    type(input, 'contra');
    vi.advanceTimersByTime(1500);
    type(input, 'contra ');
    vi.advanceTimersByTime(1500);
    type(input, 'waltz');
    type(input, '');
    vi.advanceTimersByTime(1500);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('ignores typing in range inputs and non-input elements', () => {
    document.body.innerHTML = '<input type="range" data-track-search="x" /><textarea data-track-search="x"></textarea>';
    document.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('textarea')!.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(5000);
    expect(track).not.toHaveBeenCalled();
  });

  it.each([
    ['astro:before-preparation', () => document.dispatchEvent(new Event('astro:before-preparation'))],
    ['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
  ])('sends a pending search on %s', (_name, leave) => {
    document.body.innerHTML = '<input data-track-search="activities" />';
    type(document.querySelector('input')!, 'parachute');
    leave();
    expect(track).toHaveBeenCalledWith('search', { search_term: 'parachute', search_location: 'activities' });
  });

  it('only installs its listeners once', async () => {
    const mod = await import('./featureTracking');
    mod.initFeatureTracking();
    click('<button id="clear-all-filters"></button>');
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('sends a repeated search once GA loads, if the first one was dropped before consent', () => {
    delete window.gtag;
    document.body.innerHTML = '<pagefind-modal><input /></pagefind-modal>';
    const input = document.querySelector('input')!;
    type(input, 'membership');
    vi.advanceTimersByTime(1500);

    window.gtag = vi.fn();
    type(input, '');
    type(input, 'membership');
    vi.advanceTimersByTime(1500);
    type(input, 'membership ');
    vi.advanceTimersByTime(1500);

    expect(track.mock.calls.filter(([name]) => name === 'search')).toHaveLength(2);
  });
});

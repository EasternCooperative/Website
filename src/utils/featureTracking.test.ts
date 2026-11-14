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
});

import { describe, expect, it } from 'vitest';
import { formatHash, parseHash } from './route';
import type { View } from './model';

const allowed: View[] = ['people', 'events'];

describe('route', () => {
  it('reads a view and a person from the hash', () => {
    expect(parseHash('#/events', allowed, 'people')).toEqual({ view: 'events', id: null, query: '' });
    expect(parseHash('#/people/12', allowed, 'people')).toEqual({ view: 'people', id: 12, query: '' });
  });
  it('falls back for anything unknown or not allowed, and ignores a bad id', () => {
    expect(parseHash('', allowed, 'people')).toEqual({ view: 'people', id: null, query: '' });
    expect(parseHash('#/nope/3', allowed, 'people')).toEqual({ view: 'people', id: null, query: '' });
    expect(parseHash('#/users', allowed, 'people').view).toBe('people');
    expect(parseHash('#/people/abc', allowed, 'people').id).toBeNull();
    expect(parseHash('#/people/-4', allowed, 'people').id).toBeNull();
  });
  it('keeps a query for views that hold their settings in the address, and only for known views', () => {
    expect(parseHash('#/events?event=3&type=Games', allowed, 'people')).toEqual({
      view: 'events',
      id: null,
      query: 'event=3&type=Games',
    });
    expect(parseHash('#/nope?x=1', allowed, 'people').query).toBe('');
  });
  it('writes a hash back', () => {
    expect(formatHash('events')).toBe('#/events');
    expect(formatHash('people', 7)).toBe('#/people/7');
    expect(formatHash('events', null, 'event=3')).toBe('#/events?event=3');
  });
});

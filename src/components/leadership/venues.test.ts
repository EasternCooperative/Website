import { describe, expect, it } from 'vitest';
import { venueOptions } from './venues';
import type { EventRow } from './model';

const ev = (id: number, site_id: string | null): EventRow => ({
  id,
  name: 'X',
  event_type: 'weekend',
  year: 2026,
  site_id,
});

describe('venueOptions', () => {
  it('merges site venues, added venues, and unknown ones events name, by name', () => {
    const out = venueOptions(
      [{ id: 'camp-onas', name: 'Camp Onas', lat: 40, lng: -75 }],
      [{ id: 'my-place', name: 'Another Place', lat: 41, lng: -74 }],
      [ev(1, 'camp-onas'), ev(2, 'mystery'), ev(3, null)]
    );
    expect(out.map((v) => v.name)).toEqual(['Another Place', 'Camp Onas', 'mystery']);
    expect(out.find((v) => v.id === 'mystery')).toEqual({ id: 'mystery', name: 'mystery', lat: null, lng: null });
  });
});

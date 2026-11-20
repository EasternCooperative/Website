import { describe, expect, it } from 'vitest';
import { seriesList, seriesOf, suggestedDate, venueOptions } from './series';
import type { EventRow } from './model';

const ev = (id: number, name: string, start_date: string | null, site_id: string | null = null): EventRow => ({
  id,
  name,
  event_type: 'weekend',
  year: Number((start_date ?? '2000').slice(0, 4)),
  start_date,
  site_id,
});

describe('seriesOf', () => {
  it('groups the ways an event is named into the recurring event it is', () => {
    expect(seriesOf('Winter Adventure 2025')).toBe('Winter Adventure');
    expect(seriesOf('Winter Workshop -07')).toBe('Winter Adventure');
    expect(seriesOf('Spring Camping Weekend 2024')).toBe('Camping Weekend');
    expect(seriesOf('Summer Weekend at Camp Onas')).toBe('Camping Weekend');
    expect(seriesOf('Spring Weekend at Stony Point')).toBe('Spring Weekend');
    expect(seriesOf('Fall Weekend')).toBe('Fall Weekend');
    expect(seriesOf('Summer School 2019')).toBe('Summer School');
    expect(seriesOf('May Fun Day in Philly')).toBe('Fun Day');
    expect(seriesOf('Dance and Meet 2022 at Somewhere')).toBe('Dance and Meet');
    expect(seriesOf('Something Else -12')).toBe('Something Else');
  });
  it('leaves out virtual events and empty names', () => {
    expect(seriesOf('Virtual Dance 2021')).toBeNull();
    expect(seriesOf('Zoom Games')).toBeNull();
    expect(seriesOf('2021')).toBeNull();
  });
});

describe('seriesList', () => {
  const events = [
    ev(1, 'Winter Adventure 2024', '2024-12-27'),
    ev(2, 'Winter Adventure 2025', '2025-12-27'),
    ev(3, 'Winter Adventure 2026', '2026-12-28'),
    ev(4, 'Camping Weekend 2026', '2026-06-20'),
    ev(5, 'Spring Weekend 2027', '2027-04-02'),
    ev(6, 'Spring Weekend 2026', '2026-04-03'),
    ev(7, 'Fall Weekend 2020', null),
    ev(8, 'Virtual Thing', '2021-01-01'),
  ];
  it('lists each recurring event with its upcoming and last occurrence, newest first', () => {
    const list = seriesList(events, '2026-11-20');
    expect(list.map((s) => s.name)).toEqual(['Spring Weekend', 'Winter Adventure', 'Camping Weekend']);
    const winter = list.find((s) => s.name === 'Winter Adventure')!;
    expect(winter.upcoming?.id).toBe(3);
    expect(winter.last?.id).toBe(2);
    expect(winter.events.map((e) => e.id)).toEqual([3, 2, 1]);
    const camping = list.find((s) => s.name === 'Camping Weekend')!;
    expect(camping.upcoming).toBeNull();
    expect(camping.last?.id).toBe(4);
  });
  it('treats the earliest future one as the upcoming one, and a series with only future events as having no last', () => {
    const spring = seriesList(events, '2026-11-20').find((s) => s.name === 'Spring Weekend')!;
    expect(spring.upcoming?.id).toBe(5);
    expect(spring.last?.id).toBe(6);
    const future = seriesList([ev(9, 'New Thing 2027', '2027-01-01')], '2026-11-20')[0];
    expect(future.last).toBeNull();
  });
});

describe('seriesList ties', () => {
  it('orders two occurrences on the same day by id', () => {
    const list = seriesList(
      [ev(1, 'Fun Day 2026', '2026-05-23'), ev(2, 'Fun Day 2026 again', '2026-05-23')],
      '2026-11-20'
    );
    expect(list[0].events.map((e) => e.id)).toEqual([2, 1]);
  });
});

describe('suggestedDate', () => {
  const info = (events: EventRow[], today: string) => seriesList(events, today)[0];
  it('uses the one already on the calendar', () => {
    expect(suggestedDate(info([ev(1, 'Winter Adventure 2026', '2026-12-28')], '2026-11-20'), '2026-11-20')).toBe(
      '2026-12-28'
    );
  });
  it('otherwise moves the last one to the next time that day has not passed', () => {
    const camping = info([ev(1, 'Camping Weekend 2026', '2026-06-20')], '2026-11-20');
    expect(suggestedDate(camping, '2026-11-20')).toBe('2027-06-20');
    expect(suggestedDate(camping, '2026-03-01')).toBe('2026-06-20');
    const leap = info([ev(2, 'Leap Fest 2024', '2024-02-29')], '2026-11-20');
    expect(suggestedDate(leap, '2026-11-20')).toBe('2027-02-28');
  });
});

describe('venueOptions', () => {
  it('merges site venues, added venues, and unknown ones events name, by name', () => {
    const out = venueOptions(
      [{ id: 'camp-onas', name: 'Camp Onas', lat: 40, lng: -75 }],
      [{ id: 'my-place', name: 'Another Place', lat: 41, lng: -74 }],
      [ev(1, 'X', null, 'camp-onas'), ev(2, 'Y', null, 'mystery'), ev(3, 'Z', null, null)]
    );
    expect(out.map((v) => v.name)).toEqual(['Another Place', 'Camp Onas', 'mystery']);
    expect(out.find((v) => v.id === 'mystery')).toEqual({ id: 'mystery', name: 'mystery', lat: null, lng: null });
  });
});

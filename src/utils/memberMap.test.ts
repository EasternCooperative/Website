import { describe, expect, it } from 'vitest';
import {
  ABOUT_VIEW,
  geometryToPath,
  lerpColor,
  makeProjection,
  regionLabel,
  summarizeCities,
  toFlag,
  type MemberCity,
} from './memberMap';

const city = (over: Partial<MemberCity>): MemberCity => ({
  name: 'X',
  country: 'US',
  state: 'PA',
  lat: 0,
  lng: 0,
  count: 1,
  ...over,
});

describe('summarizeCities', () => {
  it('adds up members per state or province and lists other countries once each', () => {
    const { regionCounts, maxCount, intlCountries } = summarizeCities([
      city({ state: 'PA', count: 30 }),
      city({ state: 'PA', count: 10 }),
      city({ country: 'CA', state: 'ON', count: 2 }),
      city({ country: 'CH', state: null, count: 1 }),
      city({ country: 'CH', state: null, count: 4 }),
      city({ country: 'ZZ', state: null, count: 1 }),
    ]);
    expect(regionCounts).toEqual({ 'US-PA': 40, 'CA-ON': 2 });
    expect(maxCount).toBe(40);
    expect(intlCountries).toEqual([
      { code: 'CH', name: 'Switzerland' },
      { code: 'ZZ', name: 'ZZ' },
    ]);
  });

  it('keeps maxCount at 1 when there is nothing to count, so shading never divides by zero', () => {
    expect(summarizeCities([]).maxCount).toBe(1);
  });
});

describe('regionLabel', () => {
  it('names an empty region without a count', () => {
    expect(regionLabel('Ohio', 0, true)).toBe('Ohio');
  });

  it('masks counts under five when asked, and only then', () => {
    expect(regionLabel('Ohio', 3, true)).toBe('Ohio: <5 attendees');
    expect(regionLabel('Ohio', 3, false)).toBe('Ohio: 3 attendees');
    expect(regionLabel('Ohio', 12, true)).toBe('Ohio: 12 attendees');
    expect(regionLabel('Ohio', 1, false)).toBe('Ohio: 1 attendee');
  });
});

describe('helpers shared with the staff map', () => {
  it('toFlag turns a country code into a flag', () => {
    expect(toFlag('ch')).toBe('🇨🇭');
  });

  it('lerpColor blends two hex colors', () => {
    expect(lerpColor('#000000', '#ffffff', 0)).toBe('rgb(0,0,0)');
    expect(lerpColor('#000000', '#ffffff', 1)).toBe('rgb(255,255,255)');
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
  });
});

describe('makeProjection', () => {
  const project = makeProjection(ABOUT_VIEW);

  it('puts the view center in the middle of the view', () => {
    const [x, y] = project(...ABOUT_VIEW.center);
    expect(x).toBeCloseTo(ABOUT_VIEW.width / 2, 6);
    expect(y).toBeCloseTo(ABOUT_VIEW.height / 2, 6);
  });

  it('puts east to the right and north up', () => {
    const [cx, cy] = project(-96, 44);
    const [ex] = project(-80, 44);
    const [, ny] = project(-96, 50);
    expect(ex).toBeGreaterThan(cx);
    expect(ny).toBeLessThan(cy);
  });

  it('matches d3 geoMercator', () => {
    // Reference values from d3-geo: geoMercator().center([-96, 44]).scale(520).translate([400, 280])
    const [px, py] = project(-75.1635262, 39.9527237);
    expect(px).toBeCloseTo(589.1058376, 6);
    expect(py).toBeCloseTo(329.43624558, 6);
    const [wx, wy] = project(-124.7, 48.4);
    expect(wx).toBeCloseTo(139.52706243, 6);
    expect(wy).toBeCloseTo(222.26002049, 6);
  });
});

describe('geometryToPath', () => {
  const square = (lng: number, lat: number, size: number) => [
    [lng, lat],
    [lng + size, lat],
    [lng + size, lat + size],
    [lng, lat + size],
    [lng, lat],
  ];

  it('draws an on-screen polygon as a closed path', () => {
    const d = geometryToPath({ type: 'Polygon', coordinates: [square(-100, 40, 4)] }, ABOUT_VIEW);
    expect(d).toMatch(/^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+){3}Z$/);
  });

  it('drops rings that are entirely off the view, keeping the rest of a MultiPolygon', () => {
    const d = geometryToPath(
      { type: 'MultiPolygon', coordinates: [[square(-100, 40, 4)], [square(170, 52, 4)], [square(-100, 80, 4)]] },
      ABOUT_VIEW
    );
    expect(d.match(/M/g)).toHaveLength(1);
  });

  it('drops specks too small to see', () => {
    expect(geometryToPath({ type: 'Polygon', coordinates: [square(-100, 40, 0.001)] }, ABOUT_VIEW)).toBe('');
  });

  it('thins a densely sampled straight edge without changing its shape', () => {
    const edge = Array.from({ length: 400 }, (_, i) => [-100 + i * 0.01, 40]);
    const ring = [...edge, [-96, 44], [-100, 44], [-100, 40]];
    const d = geometryToPath({ type: 'Polygon', coordinates: [ring] }, ABOUT_VIEW);
    expect(d.match(/[ML]/g)!.length).toBeLessThan(10);
  });

  it('draws a ring that is not explicitly closed, and one whose ends coincide after thinning', () => {
    const open = [
      [-100, 40],
      [-96, 40],
      [-96, 44],
      [-100, 44],
    ];
    expect(geometryToPath({ type: 'Polygon', coordinates: [open] }, ABOUT_VIEW)).toMatch(/^M.*Z$/);
    // a doubled closing point leaves first and last equal: a zero-length chord for the simplifier
    const doubled = [...open, open[0], open[0]];
    expect(geometryToPath({ type: 'Polygon', coordinates: [doubled] }, ABOUT_VIEW)).toMatch(/^M.*Z$/);
  });

  it('drops a ring with too few points to be an area', () => {
    const line = [
      [-100, 40],
      [-96, 44],
    ];
    expect(geometryToPath({ type: 'Polygon', coordinates: [line] }, ABOUT_VIEW)).toBe('');
  });

  it('ignores geometry types it does not draw', () => {
    expect(geometryToPath({ type: 'Point', coordinates: [-96, 44] }, ABOUT_VIEW)).toBe('');
  });
});

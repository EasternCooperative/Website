// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import MemberHeatmap from '~/components/widgets/MemberHeatmap';
import { cleanup, render, settle } from '../react';

const cities = [
  { name: 'Philadelphia, PA', country: 'US', state: 'PA', lat: 39.95, lng: -75.16, count: 30 },
  { name: 'Pittsburgh, PA', country: 'US', state: 'PA', lat: 40.44, lng: -79.99, count: 3 },
  { name: 'Toronto, ON', country: 'CA', state: 'ON', lat: 43.65, lng: -79.38, count: 2 },
  { name: 'Seattle, WA', country: 'US', state: 'WA', lat: 47.61, lng: -122.33, count: 1 },
  { name: 'Zurich', country: 'CH', state: null, lat: 47.37, lng: 8.54, count: 1 },
  { name: 'London', country: 'GB', state: null, lat: 51.5, lng: -0.12, count: 1 },
];

afterEach(async () => {
  await cleanup();
  document.body.innerHTML = '';
});

const regions = (root: ParentNode) => [...root.querySelectorAll<SVGPathElement>('.rsm-geographies path')];
async function hover(path: Element) {
  await act(async () => {
    path.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 40, clientY: 50 }));
    path.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, clientX: 40, clientY: 50 }));
  });
}
const tooltip = (root: ParentNode) => root.querySelector('.pointer-events-none.fixed');

describe('MemberHeatmap', () => {
  it('draws every US state and Canadian province, shaded by how many members live there', async () => {
    const { container } = await render(<MemberHeatmap cities={cities} />);
    await settle();

    const paths = regions(container);
    expect(paths).toHaveLength(64);
    const fills = new Set(paths.map((p) => p.getAttribute('fill')));
    expect(fills.has('#e2e8f0')).toBe(true); // no members
    expect(fills.size).toBeGreaterThan(3); // PA, ON, and WA each get their own shade
  });

  it('lists members outside North America in a legend, with flags', async () => {
    const { container } = await render(<MemberHeatmap cities={cities} />);
    await settle();

    const text = container.querySelector('svg')!.textContent!;
    expect(text).toContain('Outside North America');
    expect(text).toContain('Switzerland');
    expect(text).toContain('United Kingdom');
  });

  it('has no legend when everyone is in the US or Canada', async () => {
    const { container } = await render(<MemberHeatmap cities={cities.slice(0, 4)} />);
    await settle();
    expect(container.querySelector('svg')!.textContent).not.toContain('Outside North America');
  });

  it('shows the state name and count on hover, and follows the pointer', async () => {
    const { container } = await render(<MemberHeatmap cities={cities} />);
    await settle();
    const pa = regions(container).find((p) => p.getAttribute('fill') !== '#e2e8f0')!;

    await hover(pa);

    expect(tooltip(container)?.textContent).toMatch(/attendees?$/);
    await act(async () => {
      pa.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 90, clientY: 100 }));
    });
    expect((tooltip(container) as HTMLElement).style.left).toBe('102px');

    await act(async () => {
      pa.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      pa.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    });
    expect(tooltip(container)).toBeNull();
  });

  it('masks small counts when asked', async () => {
    const { container } = await render(<MemberHeatmap cities={cities} maskSmallCounts />);
    await settle();
    // Ontario has 2 members: under five, so no exact figure
    const shades = regions(container).filter((p) => p.getAttribute('fill') !== '#e2e8f0');
    const texts: string[] = [];
    for (const p of shades) {
      await hover(p);
      texts.push(tooltip(container)?.textContent ?? '');
    }
    expect(texts.some((t) => t.includes('<5 attendees'))).toBe(true);
    expect(texts.some((t) => /: 3\d attendees/.test(t))).toBe(true);
  });

  it('names a state with no members without a count', async () => {
    const { container } = await render(<MemberHeatmap cities={cities} />);
    await settle();
    const empty = regions(container).find((p) => p.getAttribute('fill') === '#e2e8f0')!;

    await hover(empty);

    expect(tooltip(container)?.textContent).not.toMatch(/attendee/);
    expect(tooltip(container)?.textContent?.length).toBeGreaterThan(2);
  });

  describe('with a site selected', () => {
    const activeSite = { lat: 39.9, lng: -75.37, name: 'Pendle Hill', maxMiles: 100, bands: [20, 40, 60, 80, 100] };

    it('colours each state by its nearest member’s distance band, and pins the site', async () => {
      const { container } = await render(<MemberHeatmap cities={cities} activeSite={activeSite} />);
      await settle();

      const fills = new Set(regions(container).map((p) => p.getAttribute('fill')));
      expect(fills.has('#1e3a8a')).toBe(true); // PA has members inside the nearest band
      expect(fills.has('#f1f5f9')).toBe(true); // states with no members fade out
      expect(container.querySelector('.rsm-marker circle')).toBeTruthy();
    });

    it('says how many members are within range on hover', async () => {
      const { container } = await render(<MemberHeatmap cities={cities} activeSite={activeSite} />);
      await settle();
      const texts: string[] = [];
      for (const p of regions(container).filter((r) => r.getAttribute('fill') !== '#f1f5f9')) {
        await hover(p);
        texts.push(tooltip(container)?.textContent ?? '');
      }
      expect(texts.some((t) => /: \d+ of \d+ attendees within 100 mi/.test(t))).toBe(true);
      expect(texts.some((t) => /no attendees within 100 mi/.test(t))).toBe(true);
    });
  });
});

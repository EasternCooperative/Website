// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import SiteEvaluator, { BAND_COLORS } from '~/components/widgets/SiteEvaluator';
import { buttonWithText, cleanup, click, render, settle, textOf, type } from '../react';

const cities = [
  { name: 'Philadelphia, PA', lat: 39.95, lng: -75.16, count: 30 },
  { name: 'Wilmington, DE', lat: 39.74, lng: -75.55, count: 10 },
  { name: 'Boston, MA', lat: 42.36, lng: -71.06, count: 5 },
  { name: 'Seattle, WA', lat: 47.61, lng: -122.33, count: 4 },
  { name: 'Nowhere', lat: null, lng: null, count: 99 },
];
const sites = [
  { id: 'camp-onas', name: 'Camp Onas', address: 'Ottsville, PA', lat: 40.55, lng: -75.1 },
  { id: 'pendle-hill', name: 'Pendle Hill', address: 'Wallingford, PA', lat: 39.9, lng: -75.37 },
];

const select = (root: ParentNode) => root.querySelector<HTMLSelectElement>('select')!;
const address = (root: ParentNode) => root.querySelector<HTMLInputElement>('input[type=text]')!;
const slider = (root: ParentNode) => root.querySelector<HTMLInputElement>('input[type=range]')!;

async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function setRange(el: HTMLInputElement, value: number) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function mount(onSiteChange = vi.fn()) {
  const { container } = await render(<SiteEvaluator cities={cities} knownSites={sites} onSiteChange={onSiteChange} />);
  return { container, onSiteChange };
}

describe('SiteEvaluator: an existing site', () => {
  it('lists the known sites and shows nothing until one is picked', async () => {
    const { container } = await mount();

    const options = [...select(container).options].map((o) => o.textContent);
    expect(options).toEqual(['— Pick a site —', 'Camp Onas', 'Pendle Hill']);
    expect(textOf(container)).not.toContain('Reach from');
    expect(textOf(container)).toContain('100 mi');
  });

  it('shows how many members live within each distance band, ignoring cities with no location', async () => {
    const { container, onSiteChange } = await mount();

    await choose(select(container), 'pendle-hill');

    expect(textOf(container)).toContain('Reach from: Pendle Hill');
    // 49 members have a location (30 + 10 + 5 + 4); the 99 with none are left out of every figure
    const rows = [...container.querySelectorAll('tbody tr')].map((tr) => textOf(tr));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('20 mi');
    expect(rows[0]).toContain('40'); // Philadelphia + Wilmington are within 20 miles of Pendle Hill
    expect(rows[0]).toContain('82%');
    expect(onSiteChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Pendle Hill', maxMiles: 100, bands: [20, 40, 60, 80, 100] })
    );
    expect(BAND_COLORS).toHaveLength(5);
  });

  it('lists far-off clusters, farthest first', async () => {
    const { container } = await mount();

    await choose(select(container), 'pendle-hill');

    const text = textOf(container);
    // Seattle (~2,300 mi) and Boston (~280 mi) are both over 200 miles from Pendle Hill; Wilmington is not
    expect(text).toContain('Farthest member clusters (2 cities over 200 mi)');
    expect(text.indexOf('Seattle, WA')).toBeGreaterThan(-1);
    expect(text.indexOf('Seattle, WA')).toBeLessThan(text.indexOf('Boston, MA'));
    expect(text).toContain('4 members');
    expect(text).not.toContain('Wilmington, DE 1');
  });

  it('recomputes the bands when the maximum distance changes', async () => {
    const { container, onSiteChange } = await mount();
    await choose(select(container), 'pendle-hill');

    await setRange(slider(container), 200);

    expect(textOf(container)).toContain('200 mi');
    expect(onSiteChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxMiles: 200, bands: [40, 80, 120, 160, 200] })
    );
  });

  it('changing the distance before picking a site just changes the setting', async () => {
    const { container, onSiteChange } = await mount();

    await setRange(slider(container), 50);

    expect(textOf(container)).toContain('50 mi');
    expect(onSiteChange).not.toHaveBeenCalled();
  });

  it('clears the evaluation', async () => {
    const { container, onSiteChange } = await mount();
    await choose(select(container), 'camp-onas');

    await click(buttonWithText(container, 'Clear'));

    expect(textOf(container)).not.toContain('Reach from');
    expect(select(container).value).toBe('');
    expect(onSiteChange).toHaveBeenLastCalledWith(null);
  });

  it('ignores an id it does not know', async () => {
    const { container, onSiteChange } = await mount();
    await choose(select(container), 'missing');
    expect(onSiteChange).not.toHaveBeenCalled();
    expect(textOf(container)).not.toContain('Reach from');
  });
});

describe('SiteEvaluator: a proposed address', () => {
  const found = [{ lat: '39.9', lon: '-75.37', display_name: 'Pendle Hill, Wallingford, Delaware County, PA, USA' }];

  it('keeps the Evaluate button off until there is an address', async () => {
    const { container } = await mount();
    expect(buttonWithText(container, 'Evaluate')!.disabled).toBe(true);
    await type(address(container), 'Somewhere');
    expect(buttonWithText(container, 'Evaluate')!.disabled).toBe(false);
  });

  it('geocodes the address and shows the reach from it', async () => {
    fetchMock.mockResolvedValue({ json: async () => found });
    const { container, onSiteChange } = await mount();
    await type(address(container), '338 Plush Mill Road, Wallingford, PA');

    await click(buttonWithText(container, 'Evaluate'));
    await settle();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('nominatim.openstreetmap.org/search?q=338%20Plush%20Mill%20Road');
    expect(textOf(container)).toContain('Reach from: Pendle Hill, Wallingford');
    expect(onSiteChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Pendle Hill, Wallingford', lat: 39.9 })
    );
  });

  it('evaluates when Enter is pressed in the address box', async () => {
    fetchMock.mockResolvedValue({ json: async () => found });
    const { container } = await mount();
    await type(address(container), 'Wallingford');

    await act(async () => {
      address(container).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('says so when the address is not found', async () => {
    fetchMock.mockResolvedValue({ json: async () => [] });
    const { container, onSiteChange } = await mount();
    await type(address(container), 'asdfgh');

    await click(buttonWithText(container, 'Evaluate'));
    await settle();

    expect(textOf(container)).toContain('Address not found. Try a more specific address.');
    expect(onSiteChange).not.toHaveBeenCalled();
  });

  it('says so when the lookup fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { container } = await mount();
    await type(address(container), 'Wallingford');

    await click(buttonWithText(container, 'Evaluate'));
    await settle();

    expect(textOf(container)).toContain('Geocoding failed. Check your connection and try again.');
    expect(buttonWithText(container, 'Evaluate')!.disabled).toBe(false);
  });

  it('does nothing for a blank address', async () => {
    const { container } = await mount();
    await type(address(container), '   ');
    await act(async () => {
      address(container).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('typing an address clears a picked site, and picking a site clears the address', async () => {
    const { container } = await mount();
    await choose(select(container), 'camp-onas');
    await type(address(container), 'Elsewhere');
    expect(select(container).value).toBe('');

    await choose(select(container), 'pendle-hill');
    expect(address(container).value).toBe('');
  });
});

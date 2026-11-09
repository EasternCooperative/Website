import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { resolveOverlays, compositeMap } from '~/components/schedule/mapCompositor';

describe('resolveOverlays', () => {
  it('returns the correct overlay filename for a known location', () => {
    expect(resolveOverlays(['Chapel A'])).toEqual(['watson_layout_chapel_a.svg']);
  });

  it('matches case-insensitively', () => {
    expect(resolveOverlays(['chapel a'])).toEqual(['watson_layout_chapel_a.svg']);
    expect(resolveOverlays(['LIBRARY'])).toEqual(['watson_layout_library.svg']);
  });

  it('trims whitespace before matching', () => {
    expect(resolveOverlays(['  Elm Room  '])).toEqual(['watson_layout_elm_room.svg']);
  });

  it('returns empty array for unknown location', () => {
    expect(resolveOverlays(['Unknown Place'])).toEqual([]);
  });

  it('returns empty array when given no locations', () => {
    expect(resolveOverlays([])).toEqual([]);
  });

  it('adds Stairs overlay when Rec Hall is in locations', () => {
    const overlays = resolveOverlays(['Rec Hall']);
    expect(overlays).toContain('watson_layout_stairs.svg');
  });

  it('adds Stairs overlay when Craft Room is in locations', () => {
    const overlays = resolveOverlays(['Craft Room']);
    expect(overlays).toContain('watson_layout_stairs.svg');
  });

  it('does not duplicate Stairs when already mapped via name', () => {
    const overlays = resolveOverlays(['Rec Hall', 'Craft Room']);
    expect(overlays.filter((f) => f === 'watson_layout_stairs.svg')).toHaveLength(1);
  });

  it('handles multiple locations and deduplicates', () => {
    const overlays = resolveOverlays(['Library', 'Martin Room', 'Library']);
    expect(overlays).toContain('watson_layout_library.svg');
    expect(overlays).toContain('watson_layout_martin_room.svg');
    expect(overlays.filter((f) => f === 'watson_layout_library.svg')).toHaveLength(1);
  });

  it('includes Chapel overlay for Chapel location', () => {
    expect(resolveOverlays(['Chapel'])).toEqual(['watson_layout_chapel.svg']);
  });
});

describe('compositeMap', () => {
  const svg = (id: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="565" height="206" viewBox="0 0 565 206"><g id="${id}"/></svg>`;
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('missing')) return { ok: false, text: async () => '' };
    return { ok: true, text: async () => svg(url.split('/').pop()!) };
  });

  beforeAll(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('returns one SVG string containing the base map and the matching overlay', async () => {
    const result = await compositeMap(['Library']);
    expect(result.startsWith('<svg')).toBe(true);
    expect(result).toContain('viewBox="0 0 565 206"');
    expect(result).toContain('id="watson_layout.svg"');
    expect(result).toContain('id="watson_layout_library.svg"');
    expect(result.match(/<svg/g)).toHaveLength(1);
  });

  it('returns just the base map for empty or unknown locations', async () => {
    for (const locations of [[], ['Unknown Place']]) {
      const result = await compositeMap(locations);
      expect(result).toContain('id="watson_layout.svg"');
      expect(result).not.toContain('_library');
    }
  });

  it('stacks overlays for several rooms', async () => {
    const result = await compositeMap(['Elm Room', 'Chapel A']);
    expect(result).toContain('watson_layout_elm_room.svg');
    expect(result).toContain('watson_layout_chapel_a.svg');
  });

  it('uses the cached result for the same location set', async () => {
    const r1 = await compositeMap(['Martin Room']);
    const calls = fetchMock.mock.calls.length;
    const r2 = await compositeMap(['Martin Room']);
    expect(r2).toBe(r1);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});

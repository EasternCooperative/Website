// Location → overlay filename (mirrors LocationMapConfiguration.json from the C# reference).
// Keys are matched case-insensitively + trimmed at call time.
const OVERLAY_MAP: Record<string, string> = {
  'Chapel A': 'watson_layout_chapel_a.svg',
  Chapel: 'watson_layout_chapel.svg',
  'Dining Room': 'watson_layout_dining_room.svg',
  'Elm Room': 'watson_layout_elm_room.svg',
  Library: 'watson_layout_library.svg',
  'Martin Room': 'watson_layout_martin_room.svg',
  Stairs: 'watson_layout_stairs.svg',
};

const BASE_MAP_URL = '/maps/watson_layout.svg';
const MAP_DIR = '/maps/';

// Locations that don't have their own overlay but require the Stairs indicator.
const STAIRS_TRIGGER_LOCATIONS = new Set(['rec hall', 'craft room']);

/** Returns the ordered list of overlay filenames to composite for the given locations. */
export function resolveOverlays(locations: string[]): string[] {
  const normalized = locations.map((l) => l.trim());

  const overlayKeys = new Set<string>();

  for (const loc of normalized) {
    const lower = loc.toLowerCase();

    if (STAIRS_TRIGGER_LOCATIONS.has(lower)) {
      overlayKeys.add('Stairs');
    }

    // Case-insensitive lookup against OVERLAY_MAP keys
    const matched = Object.keys(OVERLAY_MAP).find((k) => k.toLowerCase() === lower);
    if (matched) {
      overlayKeys.add(matched);
    }
  }

  return Array.from(overlayKeys).map((key) => OVERLAY_MAP[key]);
}

// Fetched SVG text cache: URL → markup
const svgCache = new Map<string, string>();

async function loadSvg(url: string): Promise<string> {
  const cached = svgCache.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load map image: ${url}`);
  const text = await res.text();
  svgCache.set(url, text);
  return text;
}

/** The markup between the outer <svg ...> and </svg> tags. */
function innerSvg(svg: string): string {
  return svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

// Result cache: sorted-overlay key → merged SVG markup
const compositeCache = new Map<string, string>();

/**
 * Builds a personalized facility map as a single SVG string (base map plus one overlay
 * per room the attendee visits). It stays vector, so pdfmake embeds it as lines and
 * outlined lettering that stay sharp at any zoom. Falls back to the base layout when
 * no overlay matches.
 */
export async function compositeMap(locations: string[]): Promise<string> {
  const overlayFiles = resolveOverlays(locations);
  const cacheKey = [...overlayFiles].sort().join('|');

  const cached = compositeCache.get(cacheKey);
  if (cached) return cached;

  const base = await loadSvg(BASE_MAP_URL);
  const viewBox = base.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 565 206';
  let body = innerSvg(base);

  for (const file of overlayFiles) {
    try {
      body += innerSvg(await loadSvg(`${MAP_DIR}${file}`));
    } catch {
      // Silently skip missing overlays — same behavior as C# reference
    }
  }

  const [, , w, h] = viewBox.split(/\s+/);
  const result = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">${body}</svg>`;
  compositeCache.set(cacheKey, result);
  return result;
}

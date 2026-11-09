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
// The maps are vector, so rasterize well above their 565x206 user-unit size: at 504pt
// wide on the printed page, 4x is roughly 320 dpi.
const RASTER_SCALE = 4;
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

// Image cache: URL → loaded HTMLImageElement (decoded, ready to draw)
const imageCache = new Map<string, HTMLImageElement>();

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to load map image: ${url}`));
    img.src = url;
  });
}

// Result cache: sorted-location-key → base64 data URL
const compositeCache = new Map<string, string>();

/**
 * Composites a personalized facility map as a base64 PNG data URL.
 * Falls back to the base layout if no overlay matches.
 */
export async function compositeMap(locations: string[]): Promise<string> {
  const overlayFiles = resolveOverlays(locations);
  const cacheKey = [...overlayFiles].sort().join('|');

  const cached = compositeCache.get(cacheKey);
  if (cached) return cached;

  const baseImg = await loadImage(BASE_MAP_URL);

  const canvas = document.createElement('canvas');
  const width = baseImg.naturalWidth * RASTER_SCALE;
  const height = baseImg.naturalHeight * RASTER_SCALE;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(baseImg, 0, 0, width, height);

  for (const file of overlayFiles) {
    try {
      const overlay = await loadImage(`${MAP_DIR}${file}`);
      ctx.drawImage(overlay, 0, 0, width, height);
    } catch {
      // Silently skip missing overlays — same behavior as C# reference
    }
  }

  const result = canvas.toDataURL('image/png');
  compositeCache.set(cacheKey, result);
  return result;
}

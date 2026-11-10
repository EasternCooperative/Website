// Build-time helpers for the member map on the About page
// (src/components/widgets/MemberMap.astro). The map is drawn into the HTML at
// build time as plain SVG, so it needs no JavaScript and no map library in the
// browser. The interactive staff version (MemberHeatmap.tsx) shares the small
// pure helpers at the top.

export interface MemberCity {
  name: string;
  country: string;
  state: string | null;
  lat: number | null;
  lng: number | null;
  count: number;
}

export const ISO2_NAME: Record<string, string> = {
  CH: 'Switzerland',
  GB: 'United Kingdom',
  DE: 'Germany',
  FR: 'France',
  AU: 'Australia',
  NZ: 'New Zealand',
  JP: 'Japan',
  BR: 'Brazil',
  MX: 'Mexico',
  IE: 'Ireland',
  NL: 'Netherlands',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
};

export function toFlag(code: string): string {
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
}

export function lerpColor(a: string, b: string, t: number): string {
  const hex = (s: string) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const [ar, ag, ab] = hex(a);
  const [br, bg, bb] = hex(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

export interface RegionSummary {
  /** `US-PA` / `CA-ON` -> members in that state or province */
  regionCounts: Record<string, number>;
  maxCount: number;
  /** Countries outside the US and Canada, in first-seen order. */
  intlCountries: { code: string; name: string }[];
}

export function summarizeCities(cities: MemberCity[]): RegionSummary {
  const regionCounts: Record<string, number> = {};
  const seen = new Set<string>();
  const intlCountries: { code: string; name: string }[] = [];

  for (const city of cities) {
    if ((city.country === 'US' || city.country === 'CA') && city.state) {
      const key = `${city.country}-${city.state}`;
      regionCounts[key] = (regionCounts[key] ?? 0) + city.count;
    } else if (!seen.has(city.country)) {
      seen.add(city.country);
      intlCountries.push({ code: city.country, name: ISO2_NAME[city.country] ?? city.country });
    }
  }

  return { regionCounts, maxCount: Math.max(...Object.values(regionCounts), 1), intlCountries };
}

/** Tooltip text for a region; counts under five are masked when `mask` is set. */
export function regionLabel(name: string, count: number, mask: boolean): string {
  if (count <= 0) return name;
  const masked = mask && count < 5;
  return `${name}: ${masked ? '<5' : count} attendee${masked || count !== 1 ? 's' : ''}`;
}

// ---------------------------------------------------------------------------
// Projection: spherical Mercator, matching d3's geoMercator with a center and
// scale, so the picture is the one the interactive map draws.
// ---------------------------------------------------------------------------

export interface MapView {
  width: number;
  height: number;
  /** [lng, lat] shown at the middle of the view. */
  center: [number, number];
  /** d3 scale: view units per radian of longitude. */
  scale: number;
}

export const ABOUT_VIEW: MapView = { width: 800, height: 560, center: [-96, 44], scale: 520 };

const RAD = Math.PI / 180;
const mercatorY = (latDeg: number) => Math.log(Math.tan(Math.PI / 4 + (latDeg * RAD) / 2));

export function makeProjection(view: MapView) {
  const x0 = view.center[0] * RAD;
  const y0 = mercatorY(view.center[1]);
  return (lng: number, lat: number): [number, number] => [
    view.width / 2 + view.scale * (lng * RAD - x0),
    view.height / 2 - view.scale * (mercatorY(lat) - y0),
  ];
}

type Position = number[];
type Ring = Position[];
interface Geometry {
  type: string;
  coordinates: unknown;
}

function polygonsOf(geometry: Geometry): Ring[][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates as Ring[]];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as Ring[][];
  return [];
}

/** Rings smaller than this in both directions are invisible specks. */
const MIN_RING_SPAN = 0.6;
/**
 * Simplification tolerance, in view units (the map is drawn about 1:1 to 1.1:1
 * on screen). Coastlines carry far more detail than a state-level map can show;
 * dropping points that deviate less than this from the line keeps the outline
 * visually identical while cutting the markup several times over.
 */
const TOLERANCE = 0.45;

type Pt = [number, number];

/** Distance from p to the segment a-b. */
function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker on an open polyline; always keeps both endpoints. Iterative, so long coastlines can't overflow the stack. */
function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let worst = -1;
    let worstDist = tolerance;
    for (let i = from + 1; i < to; i++) {
      const dist = segmentDistance(points[i], points[from], points[to]);
      if (dist > worstDist) {
        worst = i;
        worstDist = dist;
      }
    }
    if (worst > -1) {
      keep[worst] = 1;
      stack.push([from, worst], [worst, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/**
 * SVG path data for a geometry projected into `view`, or '' if none of it is on
 * screen. Rings entirely outside the view are dropped (Alaska's far islands,
 * northern Canada), as are specks; the rest are thinned to sub-pixel precision.
 */
export function geometryToPath(geometry: Geometry, view: MapView): string {
  const project = makeProjection(view);
  const margin = 4;
  let d = '';

  for (const polygon of polygonsOf(geometry)) {
    for (const ring of polygon) {
      const projected: Pt[] = [];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [lng, lat] of ring) {
        const p = project(lng, lat);
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
        projected.push(p);
      }
      // GeoJSON rings repeat their first point at the end; the path closes with Z instead.
      const open =
        projected.length > 1 && projected[0][0] === projected.at(-1)![0] && projected[0][1] === projected.at(-1)![1]
          ? projected.slice(0, -1)
          : projected;
      const points = simplify(open, TOLERANCE);
      const offscreen = maxX < -margin || minX > view.width + margin || maxY < -margin || minY > view.height + margin;
      if (offscreen || (maxX - minX < MIN_RING_SPAN && maxY - minY < MIN_RING_SPAN) || points.length < 3) continue;

      d += points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`).join('') + 'Z';
    }
  }
  return d;
}

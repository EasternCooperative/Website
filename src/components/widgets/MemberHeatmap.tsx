import { useMemo, useState } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from '@vnedyalk0v/react19-simple-maps';
import geoData from '~/data/us-ca-admin1.json';
import { BAND_COLORS } from './SiteEvaluator';

interface MemberCity {
  name: string;
  country: string;
  state: string | null;
  lat: number | null;
  lng: number | null;
  count: number;
}

interface ActiveSite {
  lat: number;
  lng: number;
  name: string;
  maxMiles: number;
  bands: number[];
}

interface Props {
  cities: MemberCity[];
  activeSite?: ActiveSite | null;
  maskSmallCounts?: boolean;
}

const ISO2_NAME: Record<string, string> = {
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

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toFlag(code: string): string {
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
}

function lerpColor(a: string, b: string, t: number): string {
  const hex = (s: string) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const [ar, ag, ab] = hex(a);
  const [br, bg, bb] = hex(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

export default function MemberHeatmap({ cities, activeSite, maskSmallCounts = false }: Props) {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  const { regionCounts, maxCount, intlCountries, stateBandIndex, stateInRangeCount } = useMemo(() => {
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

    const maxCount = Math.max(...Object.values(regionCounts), 1);

    // For each state with attendees, find the band index of its closest city and count of in-range attendees.
    const stateBandIndex = new Map<string, number>();
    const stateInRangeCount = new Map<string, number>();
    if (activeSite) {
      const stateMinDist = new Map<string, number>();
      for (const city of cities) {
        if (city.lat === null || city.lng === null) continue;
        if (!((city.country === 'US' || city.country === 'CA') && city.state)) continue;
        const key = `${city.country}-${city.state}`;
        const dist = haversineMiles(activeSite.lat, activeSite.lng, city.lat, city.lng);
        if (!stateMinDist.has(key) || dist < stateMinDist.get(key)!) {
          stateMinDist.set(key, dist);
        }
        if (dist <= activeSite.maxMiles) {
          stateInRangeCount.set(key, (stateInRangeCount.get(key) ?? 0) + city.count);
        }
      }
      for (const [key, dist] of stateMinDist) {
        const bandIdx = activeSite.bands.findIndex((b) => dist <= b);
        stateBandIndex.set(key, bandIdx);
      }
    }

    return { regionCounts, maxCount, intlCountries, stateBandIndex, stateInRangeCount };
  }, [cities, activeSite]);

  const ROW_H = 20;
  // Anchor the list to the bottom-right corner; grow upward from y=548
  const INTL_X = 14;
  const INTL_Y = 548 - intlCountries.length * ROW_H - 22;

  return (
    <div className="relative border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800">
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ center: [-96, 44] as [number, number], scale: 520 } as never}
        viewBox="0 0 800 560"
        style={{ width: '100%', height: 'auto' }}
      >
        <ZoomableGroup>
          <Geographies geography={geoData}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const key = `${geo.properties.iso_a2}-${geo.properties.postal}`;
                const count = regionCounts[key] ?? 0;
                const t = count > 0 ? Math.sqrt(count / maxCount) : 0;

                let fill: string;
                let hoverFill: string;
                if (activeSite && count > 0) {
                  const bandIdx = stateBandIndex.get(key) ?? -1;
                  const color =
                    bandIdx >= 0 ? (BAND_COLORS[bandIdx] ?? BAND_COLORS[BAND_COLORS.length - 1]) : '#94a3b8';
                  fill = color;
                  hoverFill = color;
                } else if (activeSite) {
                  fill = '#f1f5f9';
                  hoverFill = '#e2e8f0';
                } else {
                  fill = count > 0 ? lerpColor('#fed7aa', '#c2410c', t) : '#e2e8f0';
                  hoverFill = count > 0 ? lerpColor('#fdba74', '#9a3412', t) : '#cbd5e1';
                }
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke="#ffffff"
                    strokeWidth={0.5}
                    style={{
                      default: { outline: 'none' },
                      hover: { outline: 'none', fill: hoverFill },
                      pressed: { outline: 'none' },
                    }}
                    onMouseEnter={(e) => {
                      let label: string;
                      if (activeSite && count > 0) {
                        const inRange = stateInRangeCount.get(key) ?? 0;
                        if (inRange > 0) {
                          label = `${geo.properties.name}: ${inRange} of ${count} attendees within ${activeSite.maxMiles} mi`;
                        } else {
                          label = `${geo.properties.name}: no attendees within ${activeSite.maxMiles} mi`;
                        }
                      } else if (count > 0) {
                        const masked = maskSmallCounts && count < 5;
                        label = `${geo.properties.name}: ${masked ? '<5' : count} attendee${masked || count !== 1 ? 's' : ''}`;
                      } else {
                        label = geo.properties.name;
                      }
                      setTooltip({ text: label, x: e.clientX, y: e.clientY });
                    }}
                    onMouseMove={(e) => {
                      setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null));
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                );
              })
            }
          </Geographies>

          {/* Active site pin */}
          {activeSite && (
            <Marker coordinates={[activeSite.lng, activeSite.lat] as never}>
              <circle r={6} fill="#1d4ed8" stroke="#ffffff" strokeWidth={2} />
              <circle r={14} fill="#1d4ed8" fillOpacity={0.15} />
            </Marker>
          )}
        </ZoomableGroup>

        {/* International members — fixed legend in bottom-right corner */}
        {intlCountries.length > 0 && (
          <g transform={`translate(${800 - INTL_X}, ${INTL_Y})`} pointerEvents="none">
            <rect
              x={-intlCountries.reduce((max, c) => Math.max(max, c.name.length * 6 + 32), 120)}
              y={-4}
              width={intlCountries.reduce((max, c) => Math.max(max, c.name.length * 6 + 32), 120)}
              height={22 + intlCountries.length * ROW_H + 4}
              rx={6}
              fill="white"
              fillOpacity={0.75}
            />
            <text fontSize={8} fontWeight={700} fill="#64748b" letterSpacing={1} textAnchor="end" x={-4} y={8}>
              Outside North America
            </text>
            {intlCountries.map((c, i) => (
              <text
                key={c.code}
                fontSize={10}
                fill="#1e293b"
                dominantBaseline="middle"
                fontFamily="system-ui, sans-serif"
                textAnchor="end"
                x={-4}
                y={24 + i * ROW_H}
              >
                {toFlag(c.code)} {c.name}
              </text>
            ))}
          </g>
        )}
      </ComposableMap>

      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 rounded bg-gray-900 px-2 py-1 text-xs text-white shadow"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

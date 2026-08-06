import { useState, useCallback } from 'react';

interface MemberCity {
  name: string;
  lat: number | null;
  lng: number | null;
  count: number;
}

interface KnownSite {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface ActiveSite {
  lat: number;
  lng: number;
  name: string;
  maxMiles: number;
  bands: number[];
}

// Shared palette — index matches band index (closest → farthest).
export const BAND_COLORS = ['#1e3a8a', '#1d4ed8', '#60a5fa', '#93c5fd', '#bfdbfe'];

interface Props {
  cities: MemberCity[];
  knownSites: KnownSite[];
  onSiteChange: (site: ActiveSite | null) => void;
}

const DEFAULT_MAX = 100;

function bandsFromMax(max: number): number[] {
  const step = Math.round(max / 5 / 5) * 5 || 5;
  return [1, 2, 3, 4, 5].map((n) => Math.min(n * step, max));
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeReach(cities: MemberCity[], siteLat: number, siteLng: number, bands: number[]) {
  const geocoded = cities.filter((c) => c.lat !== null && c.lng !== null);
  const total = geocoded.reduce((s, c) => s + c.count, 0);

  const bandRows = bands.map((miles) => {
    const within = geocoded
      .filter((c) => haversineMiles(siteLat, siteLng, c.lat!, c.lng!) <= miles)
      .reduce((s, c) => s + c.count, 0);
    return { miles, within, pct: total > 0 ? Math.round((within / total) * 100) : 0 };
  });

  const withDistances = geocoded
    .map((c) => ({ ...c, miles: Math.round(haversineMiles(siteLat, siteLng, c.lat!, c.lng!)) }))
    .sort((a, b) => b.miles - a.miles);

  return { bands: bandRows, withDistances, total };
}

export default function SiteEvaluator({ cities, knownSites, onSiteChange }: Props) {
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [customAddress, setCustomAddress] = useState('');
  const [result, setResult] = useState<ReturnType<typeof computeReach> | null>(null);
  const [siteName, setSiteName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [maxMiles, setMaxMiles] = useState(DEFAULT_MAX);
  const [lastSite, setLastSite] = useState<{ lat: number; lng: number; name: string } | null>(null);

  const evalKnownSite = useCallback(
    (id: string) => {
      const site = knownSites.find((s) => s.id === id);
      if (!site) return;
      const activeSite = { lat: site.lat, lng: site.lng, name: site.name };
      setSiteName(site.name);
      setLastSite(activeSite);
      setResult(computeReach(cities, site.lat, site.lng, bandsFromMax(maxMiles)));
      onSiteChange({ ...activeSite, maxMiles, bands: bandsFromMax(maxMiles) });
      setError('');
    },
    [cities, knownSites, maxMiles, onSiteChange]
  );

  const evalCustomAddress = useCallback(async () => {
    if (!customAddress.trim()) return;
    setLoading(true);
    setError('');
    try {
      // Cache-bust: Nominatim's CDN caches responses (headers included) keyed only by query
      // string, ignoring the Origin header. A cached hit from a non-browser client can strip
      // the CORS header, breaking fetch() for that exact address until the entry expires.
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(customAddress)}&format=json&limit=1&_=${Date.now()}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      if (!data.length) {
        setError('Address not found. Try a more specific address.');
        return;
      }
      const { lat, lon, display_name } = data[0];
      const name = display_name.split(',').slice(0, 2).join(',');
      setSiteName(name);
      const site = { lat: parseFloat(lat), lng: parseFloat(lon), name };
      setLastSite(site);
      setResult(computeReach(cities, site.lat, site.lng, bandsFromMax(maxMiles)));
      onSiteChange({ ...site, maxMiles, bands: bandsFromMax(maxMiles) });
    } catch {
      setError('Geocoding failed. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [cities, customAddress, maxMiles, onSiteChange]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Known sites */}
        <div>
          <label className="block text-sm font-medium text-default mb-1">Existing ECRS site</label>
          <select
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 px-3 py-2 text-default text-sm"
            value={selectedSiteId}
            onChange={(e) => {
              setSelectedSiteId(e.target.value);
              setCustomAddress('');
              if (e.target.value) evalKnownSite(e.target.value);
            }}
          >
            <option value="">— Pick a site —</option>
            {knownSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Custom address */}
        <div>
          <label className="block text-sm font-medium text-default mb-1">Or enter a proposed site</label>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 px-3 py-2 text-default text-sm"
              placeholder="Address, City, State"
              value={customAddress}
              onChange={(e) => {
                setCustomAddress(e.target.value);
                setSelectedSiteId('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && evalCustomAddress()}
            />
            <button
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={evalCustomAddress}
              disabled={loading || !customAddress.trim()}
            >
              {loading ? '…' : 'Evaluate'}
            </button>
          </div>
        </div>
      </div>

      {/* Distance range slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-default">Max distance</label>
          <span className="text-sm font-semibold text-primary">{maxMiles} mi</span>
        </div>
        <input
          type="range"
          min={5}
          max={200}
          step={5}
          value={maxMiles}
          onChange={(e) => {
            const val = Number(e.target.value);
            setMaxMiles(val);
            if (lastSite) {
              setResult(computeReach(cities, lastSite.lat, lastSite.lng, bandsFromMax(val)));
              onSiteChange({ ...lastSite, maxMiles: val, bands: bandsFromMax(val) });
            }
          }}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-muted mt-0.5">
          <span>5 mi</span>
          <span>200 mi</span>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-default">
              Reach from: <span className="text-primary">{siteName}</span>
            </h3>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setLastSite(null);
                setSiteName('');
                setSelectedSiteId('');
                setCustomAddress('');
                setError('');
                onSiteChange(null);
              }}
              className="text-xs text-muted hover:text-default transition-colors"
            >
              Clear
            </button>
          </div>

          {/* Distance bands */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-default">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 pr-4 font-medium">Within</th>
                  <th className="text-right py-2 pr-4 font-medium">Members</th>
                  <th className="text-right py-2 font-medium">% of all</th>
                  <th className="w-40 py-2 pl-4"></th>
                </tr>
              </thead>
              <tbody>
                {result.bands.map(({ miles, within, pct }, i) => (
                  <tr key={miles} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 pr-4">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                          style={{ background: BAND_COLORS[i] ?? BAND_COLORS[BAND_COLORS.length - 1] }}
                        />
                        {miles} mi
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{within}</td>
                    <td
                      className="py-2 pr-4 text-right tabular-nums font-semibold"
                      style={{ color: BAND_COLORS[i] ?? BAND_COLORS[BAND_COLORS.length - 1] }}
                    >
                      {pct}%
                    </td>
                    <td className="py-2 pl-4">
                      <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                        <div
                          className="h-2 rounded-full"
                          style={{
                            width: `${pct}%`,
                            background: BAND_COLORS[i] ?? BAND_COLORS[BAND_COLORS.length - 1],
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Farthest members */}
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-muted hover:text-default">
              Farthest member clusters ({result.withDistances.filter((c) => c.miles > 200).length} cities over 200 mi)
            </summary>
            <ul className="mt-2 space-y-1 text-muted">
              {result.withDistances
                .filter((c) => c.miles > 100)
                .slice(0, 15)
                .map((c) => (
                  <li key={c.name} className="flex justify-between">
                    <span>{c.name}</span>
                    <span className="tabular-nums">
                      {c.miles} mi · {c.count} member{c.count !== 1 ? 's' : ''}
                    </span>
                  </li>
                ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

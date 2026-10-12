/**
 * US plant map — one CircleMarker per plant. Radius = sqrt-scaled open-miss
 * count; the three laggards (Plano/Tulsa/Fresno) are the big bubbles. When
 * the agent's bulk assign fires `dataMutated`, plants are refetched and the
 * bubbles whose openMissCount changed get a brief stroke-thickening pulse so
 * the eye lands on what dropped.
 *
 * Leaflet notes:
 *   - radius is a top-level prop → react-leaflet calls setRadius() on diff.
 *   - pathOptions identity must change for setStyle() to fire.
 *   - FitBounds re-fits only when the set of plant IDs changes, not on
 *     count-only updates (otherwise the map wobbles every refetch).
 *   - Leaflet CSS is imported in client/src/index.css.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapIcon, RefreshCw } from 'lucide-react';
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import { fetchPlants } from '@/lib/returns';
import { dataMutated } from '@/lib/events';
import { BRAND_DANGER, BRAND_PALETTE } from '@/lib/brand';
import type { PlantRow } from '@/shared/types';

// Leaflet's pathOptions take plain strings, not CSS vars — so these come from
// the brand.ts mirror of the token palette rather than being written by hand.
const PRIMARY = BRAND_PALETTE[0];
const DANGER = BRAND_DANGER;
const RADIUS_MIN = 6;
const RADIUS_MAX = 34;
const RADIUS_SCALE = 3.2;
const PULSE_MS = 1100;
const PULSE_WEIGHT = 4;
const REST_WEIGHT = 1.5;

function radiusFor(count: number): number {
  return Math.max(
    RADIUS_MIN,
    Math.min(RADIUS_MAX, Math.sqrt(Math.max(1, count)) * RADIUS_SCALE),
  );
}

type Located = PlantRow & { lat: number; lng: number };

function FitBoundsOnSetChange({ plants }: { plants: Located[] }) {
  const map = useMap();
  const lastKey = useRef<string>('');
  useEffect(() => {
    if (plants.length === 0) return;
    const key = plants.map((p) => p.id).sort().join('|');
    if (key === lastKey.current) return;
    lastKey.current = key;
    const lats = plants.map((p) => p.lat);
    const lngs = plants.map((p) => p.lng);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [40, 40], animate: true },
    );
  }, [plants, map]);
  return null;
}

export function PlantMap() {
  const [plants, setPlants] = useState<PlantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function reload() {
      fetchPlants()
        .then((data) => {
          if (cancelled) return;
          setPlants(data);
          setError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setError((e as Error).message);
        });
    }
    reload();
    const unsub = dataMutated.subscribe(reload);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Couldn't load the map: {error}
      </div>
    );
  }

  if (plants === null) {
    return (
      <div className="rounded-xl border border-border bg-card h-[280px] sm:h-[360px] flex items-center justify-center text-sm text-muted-foreground gap-2">
        <RefreshCw className="size-3.5 animate-spin" />
        Loading map…
      </div>
    );
  }

  const located = plants.filter(
    (p): p is Located => p.lat !== null && p.lng !== null,
  );
  const totalOpen = located.reduce((a, p) => a + (p.openMissCount ?? 0), 0);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MapIcon className="size-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-semibold truncate">
            Open misses by plant
          </h3>
        </div>
        <div className="text-xs text-muted-foreground shrink-0">
          {located.length} plants · {totalOpen.toLocaleString()} open
        </div>
      </div>
      <div className="h-[280px] sm:h-[360px] relative">
        {located.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            No plant coordinates available.
          </div>
        ) : (
          <MapContainer
            center={[39.5, -98.35]}
            zoom={4}
            minZoom={3}
            scrollWheelZoom={false}
            className="h-full w-full"
            style={{ background: 'var(--muted)' }}
          >
            <TileLayer
              attribution="Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
              maxZoom={16}
            />
            <FitBoundsOnSetChange plants={located} />
            {located.map((p) => (
              <PlantBubble key={p.id} plant={p} />
            ))}
          </MapContainer>
        )}
      </div>
    </div>
  );
}

function PlantBubble({ plant }: { plant: Located }) {
  const open = plant.openMissCount ?? 0;
  const prev = useRef<number | null>(null);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (prev.current === null) {
      prev.current = open;
      return;
    }
    if (prev.current === open) return;
    prev.current = open;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), PULSE_MS);
    return () => clearTimeout(t);
  }, [open]);

  const color = open > 0 ? DANGER : PRIMARY;
  const pathOptions = useMemo(
    () => ({
      color,
      fillColor: color,
      fillOpacity: pulsing ? 0.75 : 0.5,
      weight: pulsing ? PULSE_WEIGHT : REST_WEIGHT,
    }),
    [pulsing, color],
  );

  const att =
    plant.attainmentPct !== null
      ? `${(plant.attainmentPct * 100).toFixed(1)}%`
      : '—';

  return (
    <CircleMarker
      center={[plant.lat, plant.lng]}
      radius={radiusFor(open || 1)}
      pathOptions={pathOptions}
    >
      <Tooltip direction="top" offset={[0, -4]} opacity={1}>
        <div className="text-xs">
          <div className="font-semibold">
            {plant.plantName}
            <span className="text-muted-foreground"> · {plant.id}</span>
          </div>
          <div>{open} open misses</div>
          <div>
            {(plant.openMissUnits ?? 0).toLocaleString()} units · {att}{' '}
            attainment
          </div>
          <div className="text-muted-foreground">
            {[plant.city, plant.state].filter(Boolean).join(', ')}
          </div>
        </div>
      </Tooltip>
    </CircleMarker>
  );
}

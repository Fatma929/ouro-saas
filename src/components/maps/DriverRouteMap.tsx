import React, { useEffect, useRef, useState } from 'react';
import {
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Navigation, Clock, Route as RouteIcon, AlertTriangle, Loader2 } from 'lucide-react';
import {
  GOOGLE_MAPS_API_KEY,
  OURO_MAP_ID,
  GMP_ATTRIBUTION_IDS,
} from './GoogleMapsProvider.tsx';

export interface RouteStop {
  id: number;
  label: string;
  sublabel: string;
  lat: number;
  lng: number;
  kind: 'pickup' | 'factory';
}

export interface ComputedRouteSummary {
  totalDistanceKm: number;
  totalDurationMin: number;
  legs: Array<{
    fromLabel: string;
    toLabel: string;
    distanceKm: number;
    durationMin: number;
  }>;
}

interface RouteOverlayProps {
  stops: RouteStop[];
  triggerVersion: number;
  onSummaryChange: (summary: ComputedRouteSummary | null, error: string | null, loading: boolean) => void;
}

interface MapPolyline {
  setMap: (map: unknown) => void;
  setOptions: (options: Record<string, unknown>) => void;
}

const MultiStopRouteOverlay: React.FC<RouteOverlayProps> = ({
  stops,
  triggerVersion,
  onSummaryChange,
}) => {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<MapPolyline[]>([]);

  useEffect(() => {
    if (!map || !routesLib || stops.length < 2) {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
      onSummaryChange(null, null, false);
      return;
    }

    let cancelled = false;
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    onSummaryChange(null, null, true);

    const origin = { lat: stops[0].lat, lng: stops[0].lng };
    const destination = { lat: stops[stops.length - 1].lat, lng: stops[stops.length - 1].lng };
    const intermediates = stops.slice(1, -1).map((s) => ({
      location: { lat: s.lat, lng: s.lng },
    }));

    // Modern Google Maps Routes API SDK wrapper: Route.computeRoutes() (zero legacy DirectionsService)
    const request: Record<string, unknown> = {
      origin,
      destination,
      travelMode: 'DRIVING',
      routingPreference: 'TRAFFIC_AWARE',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
    };
    if (intermediates.length > 0) {
      request.intermediates = intermediates;
    }

    (routesLib as any).Route.computeRoutes(request)
      .then(({ routes }: { routes: any[] }) => {
        if (cancelled) return;
        if (!routes || routes.length === 0) {
          onSummaryChange(null, 'No road route returned between assigned waypoints.', false);
          return;
        }

        const primaryRoute = routes[0];
        const newPolylines: MapPolyline[] = primaryRoute.createPolylines();
        newPolylines.forEach((polyline) => {
          polyline.setOptions({
            strokeColor: '#3D7568',
            strokeOpacity: 0.92,
            strokeWeight: 5,
          });
          polyline.setMap(map);
        });
        polylinesRef.current = newPolylines;

        if (primaryRoute.viewport) {
          map.fitBounds(primaryRoute.viewport, 48);
        }

        const rawLegs: any[] = primaryRoute.legs || [];
        const legs = rawLegs.map((leg, i) => ({
          fromLabel: stops[i]?.label || `Stop ${i + 1}`,
          toLabel: stops[i + 1]?.label || `Stop ${i + 2}`,
          distanceKm: Number(((leg.distanceMeters || 0) / 1000).toFixed(1)),
          durationMin: Math.max(1, Math.round((leg.durationMillis || 0) / 60000)),
        }));

        onSummaryChange(
          {
            totalDistanceKm: Number(((primaryRoute.distanceMeters || 0) / 1000).toFixed(1)),
            totalDurationMin: Math.max(1, Math.round((primaryRoute.durationMillis || 0) / 60000)),
            legs,
          },
          null,
          false
        );
      })
      .catch((err: any) => {
        if (cancelled) return;
        const msg = String(err?.message || err || '');
        if (
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('429')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onSummaryChange(
          null,
          'Unable to compute live traffic route right now. Waypoint pins remain active below.',
          false
        );
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, routesLib, stops, triggerVersion]);

  return null;
};

interface DriverRouteMapProps {
  stops: RouteStop[];
}

export const DriverRouteMap: React.FC<DriverRouteMapProps> = ({ stops }) => {
  const [triggerVersion, setTriggerVersion] = useState(0);
  const [summary, setSummary] = useState<ComputedRouteSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="h-[340px] rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <Navigation className="w-7 h-7 text-emerald-600 mb-2" />
        <p className="text-sm font-semibold text-[#272F31]">
          Google Maps Platform API key not configured
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Live Route Telemetry Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <RouteIcon className="w-4 h-4 text-emerald-600" />
            <span className="text-slate-500">Total Distance:</span>
            <span className="font-mono font-bold text-[#272F31] tabular-nums">
              {loading ? '...' : summary ? `${summary.totalDistanceKm} km` : '—'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-emerald-600" />
            <span className="text-slate-500">Traffic-Aware ETA:</span>
            <span className="font-mono font-bold text-emerald-700 tabular-nums">
              {loading ? '...' : summary ? `${summary.totalDurationMin} mins` : '—'}
            </span>
          </div>
          <div className="text-slate-500 font-mono">
            {stops.length} waypoints
          </div>
        </div>

        <button
          type="button"
          onClick={() => setTriggerVersion((v) => v + 1)}
          disabled={loading || stops.length < 2}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#272F31] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#333D40] disabled:opacity-50 min-h-[40px] whitespace-nowrap"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Navigation className="w-3.5 h-3.5 text-emerald-400" />
          )}
          <span>Refresh Traffic Route</span>
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Map Canvas */}
      <div className="w-full h-[380px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
        <GoogleMap
          mapId={OURO_MAP_ID}
          defaultCenter={
            stops[0] ? { lat: stops[0].lat, lng: stops[0].lng } : { lat: 30.0444, lng: 31.2357 }
          }
          defaultZoom={10}
          gestureHandling="greedy"
          streetViewControl={false}
          mapTypeControl={false}
          internalUsageAttributionIds={GMP_ATTRIBUTION_IDS}
          style={{ width: '100%', height: '100%' }}
        >
          <MultiStopRouteOverlay
            stops={stops}
            triggerVersion={triggerVersion}
            onSummaryChange={(sum, err, isLoading) => {
              setSummary(sum);
              setError(err);
              setLoading(isLoading);
            }}
          />

          {stops.map((stop, idx) => (
            <AdvancedMarker
              key={`${stop.kind}-${stop.id}-${idx}`}
              position={{ lat: stop.lat, lng: stop.lng }}
              title={`${idx + 1}. ${stop.label}`}
            >
              <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 shadow-md border font-sans text-xs font-bold whitespace-nowrap bg-white text-[#272F31] border-[#272F31]/25">
                <span
                  className={`inline-flex items-center justify-center w-5 h-5 rounded-md font-mono text-[11px] font-bold text-white ${
                    stop.kind === 'factory' ? 'bg-[#272F31]' : 'bg-emerald-600'
                  }`}
                >
                  {stop.kind === 'factory' ? 'F' : idx + 1}
                </span>
                <span className="max-w-[130px] truncate">{stop.label}</span>
              </div>
            </AdvancedMarker>
          ))}
        </GoogleMap>
      </div>

      {/* Turn-by-turn Leg Summary */}
      {summary && summary.legs.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {summary.legs.map((leg, idx) => (
            <div
              key={idx}
              className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono font-bold text-emerald-700">Leg {idx + 1}</span>
                <span className="text-slate-700 truncate">
                  {leg.fromLabel} → {leg.toLabel}
                </span>
              </div>
              <div className="font-mono tabular-nums text-slate-600 shrink-0">
                {leg.distanceKm} km · {leg.durationMin} min
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

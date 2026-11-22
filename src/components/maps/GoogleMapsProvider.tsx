import React, { useEffect, useRef, useState } from 'react';
import { APIProvider, useMapsLibrary } from '@vis.gl/react-google-maps';
import { Search, MapPin, Loader2 } from 'lucide-react';
import type { Lang } from '../../shared/i18n.ts';

export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
export const OURO_MAP_ID = 'DEMO_MAP_ID';
export const GMP_ATTRIBUTION_IDS = ['gmp_mcp_codeassist_v1_aistudio'];

export const GoogleMapsWrapper: React.FC<{
  lang: Lang;
  children: React.ReactNode;
}> = ({ lang, children }) => {
  if (!GOOGLE_MAPS_API_KEY) {
    return <>{children}</>;
  }

  return (
    <APIProvider
      apiKey={GOOGLE_MAPS_API_KEY}
      language={lang === 'ar' ? 'ar' : 'en'}
      region="EG"
    >
      {children}
    </APIProvider>
  );
};

interface PlaceResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface PlacesAutocompleteInputProps {
  placeholder?: string;
  onPlaceSelected: (place: PlaceResult) => void;
}

interface PlaceSuggestion {
  placePrediction?: {
    text: { text: string };
    toPlace: () => {
      displayName?: string;
      formattedAddress?: string;
      location?: { lat: () => number; lng: () => number };
      fetchFields: (opts: { fields: string[] }) => Promise<void>;
    };
  };
}

/**
 * Modern Places API (New) Autocomplete using AutocompleteSuggestion.fetchAutocompleteSuggestions
 * and AutocompleteSessionToken + place.fetchFields() — zero legacy PlacesService/Autocomplete usage.
 */
export const PlacesAutocompleteInput: React.FC<PlacesAutocompleteInputProps> = ({
  placeholder = 'Search Egyptian hub address via Google Places...',
  onPlaceSelected,
}) => {
  const placesLib = useMapsLibrary('places') as any;
  const sessionTokenRef = useRef<unknown>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!placesLib || !query.trim() || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        setLoading(true);
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query.trim(),
          includedRegionCodes: ['eg'],
          sessionToken: sessionTokenRef.current,
        });
        if (!cancelled) {
          setSuggestions(res.suggestions || []);
        }
      } catch (err: any) {
        const msg = String(err?.message || err || '');
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT') || msg.includes('429')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [placesLib, query]);

  const handleSelect = async (suggestion: PlaceSuggestion) => {
    if (!suggestion.placePrediction) return;
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      });
      const loc = place.location;
      if (loc) {
        onPlaceSelected({
          name: place.displayName || suggestion.placePrediction.text.text,
          address: place.formattedAddress || suggestion.placePrediction.text.text,
          lat: loc.lat(),
          lng: loc.lng(),
        });
      }
      setQuery(place.formattedAddress || suggestion.placePrediction.text.text);
      sessionTokenRef.current = null;
      setSuggestions([]);
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT') || msg.includes('429')) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 py-2 text-sm text-[#272F31] focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
        />
        {loading && (
          <Loader2 className="w-4 h-4 text-emerald-600 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
        )}
      </div>

      {suggestions.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-56 overflow-y-auto divide-y divide-slate-100">
          {suggestions.map((s, idx) => (
            <li key={idx}>
              <button
                type="button"
                onClick={() => handleSelect(s)}
                className="w-full text-left px-3.5 py-2.5 text-xs hover:bg-emerald-50 flex items-start gap-2 transition-colors"
              >
                <MapPin className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                <span className="text-[#272F31] font-medium">
                  {s.placePrediction?.text.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

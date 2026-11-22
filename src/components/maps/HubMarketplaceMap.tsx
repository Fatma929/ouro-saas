import React, { useState } from 'react';
import {
  Map as GoogleMap,
  AdvancedMarker,
  InfoWindow,
} from '@vis.gl/react-google-maps';
import { MapPin, ArrowUpRight, QrCode } from 'lucide-react';
import {
  GOOGLE_MAPS_API_KEY,
  OURO_MAP_ID,
  GMP_ATTRIBUTION_IDS,
} from './GoogleMapsProvider.tsx';
import { MATERIAL_METADATA, type MaterialCategory } from '../../shared/constants.ts';
import type { Lang } from '../../shared/i18n.ts';

interface HubMarketplaceMapProps {
  lots: any[];
  lang: Lang;
  canReserve: boolean;
  onReserveClick: (lot: any) => void;
  onInspectPassport: (code: string) => void;
}

export const HubMarketplaceMap: React.FC<HubMarketplaceMapProps> = ({
  lots,
  lang,
  canReserve,
  onReserveClick,
  onInspectPassport,
}) => {
  const [selectedLot, setSelectedLot] = useState<any>(null);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="h-[520px] rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <MapPin className="w-8 h-8 text-emerald-600 mb-2" />
        <p className="text-sm font-semibold text-[#272F31]">
          Google Maps Platform API key not configured
        </p>
        <p className="text-xs text-slate-500 mt-1 max-w-md">
          Configure VITE_GOOGLE_MAPS_API_KEY to enable interactive Egypt & MENA hub markers.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-[540px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100 relative">
      <GoogleMap
        mapId={OURO_MAP_ID}
        defaultCenter={{ lat: 30.08, lng: 31.18 }}
        defaultZoom={9}
        gestureHandling="greedy"
        streetViewControl={false}
        mapTypeControl={false}
        internalUsageAttributionIds={GMP_ATTRIBUTION_IDS}
        style={{ width: '100%', height: '100%' }}
      >
        {lots.map((lot) => {
          const isSelected = selectedLot?.id === lot.id;
          return (
            <AdvancedMarker
              key={lot.id}
              position={{ lat: lot.hub.lat, lng: lot.hub.lng }}
              title={`${lot.hub.nameEn} — ${lot.availableTons.toFixed(1)}t`}
              onClick={() => setSelectedLot(lot)}
            >
              <div
                className={`px-2.5 py-1.5 rounded-lg border shadow-md font-mono text-xs font-bold transition-transform cursor-pointer flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-[#272F31] text-white border-[#A88B64] scale-110'
                    : 'bg-white text-[#272F31] border-[#272F31]/20 hover:scale-105'
                }`}
              >
                <span className="text-emerald-600 font-extrabold">
                  {lot.availableTons.toFixed(1)}t
                </span>
                <span className="truncate max-w-[96px] font-sans font-semibold text-[11px]">
                  {lot.hub.governorate}
                </span>
              </div>
            </AdvancedMarker>
          );
        })}

        {selectedLot && (
          <InfoWindow
            position={{ lat: selectedLot.hub.lat, lng: selectedLot.hub.lng }}
            onCloseClick={() => setSelectedLot(null)}
          >
            <div className="p-1.5 max-w-[260px] text-[#272F31] space-y-2">
              <div>
                <p className="text-[11px] font-mono text-emerald-700 font-semibold">
                  {selectedLot.passportCode} · {selectedLot.purityGrade}
                </p>
                <h4 className="text-sm font-bold leading-snug">
                  {lang === 'ar' ? selectedLot.hub.nameAr : selectedLot.hub.nameEn}
                </h4>
                <p className="text-xs text-slate-600">
                  {MATERIAL_METADATA[selectedLot.materialCategory as MaterialCategory]?.[lang] ||
                    selectedLot.materialCategory}{' '}
                  — {selectedLot.materialSubtype}
                </p>
              </div>
              <div className="flex items-center justify-between text-xs font-mono border-t border-slate-200 pt-2">
                <span className="font-bold">{selectedLot.availableTons.toFixed(2)} tons</span>
                <span className="font-semibold text-emerald-700">
                  {selectedLot.pricePerTonEgp.toLocaleString()} EGP/t
                </span>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onInspectPassport(selectedLot.passportCode)}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-[#272F31] hover:bg-slate-50"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Passport</span>
                </button>
                <button
                  type="button"
                  disabled={!canReserve}
                  onClick={() => onReserveClick(selectedLot)}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <span>Reserve</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>
    </div>
  );
};

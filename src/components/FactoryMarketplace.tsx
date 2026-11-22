import React, { useEffect, useState, useCallback } from 'react';
import {
  LayoutGrid,
  Table as TableIcon,
  Map as MapIcon,
  QrCode,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  X,
  ArrowUpRight,
  FileCheck,
  Loader2,
  Package,
  Truck,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { HubMarketplaceMap } from './maps/HubMarketplaceMap.tsx';
import {
  GOVERNORATES,
  HUB_TYPE_LABELS,
  MATERIAL_METADATA,
  PICKUP_STATUS_LABELS,
  type HubType,
  type MaterialCategory,
  type PickupStatus,
} from '../shared/constants.ts';
import { TRANSLATIONS, type Lang } from '../shared/i18n.ts';

interface FactoryMarketplaceProps {
  user: any;
  lang: Lang;
  onInspectPassport: (code: string) => void;
  onOpenEsgCertificate: () => void;
}

export const FactoryMarketplace: React.FC<FactoryMarketplaceProps> = ({
  user,
  lang,
  onInspectPassport,
  onOpenEsgCertificate,
}) => {
  const t = TRANSLATIONS[lang];

  const [section, setSection] = useState<'marketplace' | 'reservations'>('marketplace');
  const [viewMode, setViewMode] = useState<'cards' | 'table' | 'map'>('cards');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [factory, setFactory] = useState<any>(user.factory || null);
  const [kpis, setKpis] = useState({
    totalAvailableTons: 0,
    activeHubsCount: 0,
    activeReservationsCount: 0,
    verifiedCo2eTons: 0,
  });
  const [lots, setLots] = useState<any[]>([]);
  const [smartMatches, setSmartMatches] = useState<any[]>([]);
  const [myReservations, setMyReservations] = useState<any[]>([]);

  // Filters
  const [catFilter, setCatFilter] = useState<string>('all');
  const [hubTypeFilter, setHubTypeFilter] = useState<string>('all');
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [govFilter, setGovFilter] = useState<string>('all');

  // Booking Drawer State
  const [bookingLot, setBookingLot] = useState<any>(null);
  const [qtyTons, setQtyTons] = useState<number>(1);
  const [pickupWindow, setPickupWindow] = useState<string>('');
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mkt, resList] = await Promise.all([
        apiFetch('/api/marketplace/lots'),
        apiFetch('/api/factory/reservations'),
      ]);
      setFactory(mkt.factory || user.factory || null);
      setKpis(mkt.kpis);
      setLots(mkt.lots || []);
      setSmartMatches(mkt.smartMatches || []);
      setMyReservations(resList.reservations || []);
    } catch (err: any) {
      setError(err.message || 'Could not load marketplace inventory.');
    } finally {
      setLoading(false);
    }
  }, [user.factory]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const kycStatus = factory?.kycStatus || (user.role === 'platform_admin' ? 'approved' : 'pending');
  const canReserve = kycStatus === 'approved' || user.role === 'platform_admin';

  const filteredLots = lots.filter((l) => {
    if (catFilter !== 'all' && l.materialCategory !== catFilter) return false;
    if (hubTypeFilter !== 'all' && l.hub.hubType !== hubTypeFilter) return false;
    if (gradeFilter !== 'all' && l.purityGrade !== gradeFilter) return false;
    if (govFilter !== 'all' && l.hub.governorate !== govFilter) return false;
    return true;
  });

  const openBookingDrawer = (lot: any) => {
    if (!canReserve) return;
    setBookingLot(lot);
    setQtyTons(Math.min(Math.max(1, Number(lot.availableTons.toFixed(1))), Math.min(3, lot.availableTons)));
    setPickupWindow(lot.pickupWindow || 'Tomorrow 09:00 - 14:00 EET');
    setBookingError(null);
  };

  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingLot) return;
    setBookingError(null);
    setBookingSubmitting(true);
    try {
      const res = await apiFetch('/api/reservations', {
        method: 'POST',
        body: JSON.stringify({
          passportId: bookingLot.id,
          quantityTons: qtyTons,
          pickupWindow,
        }),
      });
      setToast(
        `Reservation ${res.reservation.reservationCode} locked (${qtyTons} t) — 3PL ${res.provider.nameEn} assigned.`
      );
      setBookingLot(null);
      await loadData();
    } catch (err: any) {
      setBookingError(err.message || 'Reservation failed.');
    } finally {
      setBookingSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Strict KYC Verification Pending / Rejected Enforcement Banner */}
      {kycStatus !== 'approved' && (
        <div
          className={`rounded-xl border p-4 flex items-start gap-3 ${
            kycStatus === 'rejected'
              ? 'border-red-300 bg-red-50 text-red-900'
              : 'border-amber-300 bg-amber-50 text-amber-950'
          }`}
        >
          <AlertTriangle
            className={`w-5 h-5 shrink-0 mt-0.5 ${
              kycStatus === 'rejected' ? 'text-red-600' : 'text-amber-600'
            }`}
          />
          <div className="space-y-1">
            <h2 className="text-sm font-bold">
              {kycStatus === 'rejected' ? t.auth.rejectedBannerTitle : t.auth.pendingBannerTitle}
            </h2>
            <p className="text-xs leading-relaxed">
              {kycStatus === 'rejected'
                ? factory?.kycReviewNote ||
                  'Your factory registration was declined. Contact OURO compliance for re-submission.'
                : t.auth.pendingBannerBody}
            </p>
            {factory && (
              <p className="text-xs font-mono text-amber-900/80 pt-1">
                Entity: {factory.nameEn} · Tax ID: {factory.taxId} · CR: {factory.commercialRegNo}
              </p>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{toast}</span>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-emerald-800 hover:text-emerald-950"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header & Section Toggle */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            {factory
              ? `${lang === 'ar' ? factory.nameAr : factory.nameEn} · ${factory.industrialZone}`
              : 'B2B Industrial Procurement'}
          </p>
          <h1 className="text-2xl font-extrabold text-[#272F31] mt-0.5">{t.factory.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-1 rounded-lg bg-slate-200/70">
            <button
              type="button"
              onClick={() => setSection('marketplace')}
              className={`px-3.5 py-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                section === 'marketplace'
                  ? 'bg-white text-[#272F31] shadow-xs'
                  : 'text-slate-600 hover:text-[#272F31]'
              }`}
            >
              Verified Lots ({lots.length})
            </button>
            <button
              type="button"
              onClick={() => setSection('reservations')}
              className={`px-3.5 py-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                section === 'reservations'
                  ? 'bg-white text-[#272F31] shadow-xs'
                  : 'text-slate-600 hover:text-[#272F31]'
              }`}
            >
              {t.factory.myReservations} ({myReservations.length})
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenEsgCertificate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#272F31] hover:bg-[#333D40] px-3.5 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap min-h-[38px]"
          >
            <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>ESG Certificates</span>
          </button>
        </div>
      </div>

      {/* Top 4-Column KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Available Verified Tonnage</p>
          <p className="text-2xl font-extrabold font-mono tabular-nums text-[#272F31] mt-1">
            {kpis.totalAvailableTons.toFixed(1)} t
          </p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Active Waste Generators</p>
          <p className="text-2xl font-extrabold font-mono tabular-nums text-[#272F31] mt-1">
            {kpis.activeHubsCount}
          </p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Active Reservations</p>
          <p className="text-2xl font-extrabold font-mono tabular-nums text-emerald-700 mt-1">
            {kpis.activeReservationsCount}
          </p>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Verified CO2e Avoided</p>
          <p className="text-2xl font-extrabold font-mono tabular-nums text-emerald-700 mt-1">
            {kpis.verifiedCo2eTons.toFixed(2)} tCO2e
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {section === 'marketplace' ? (
        <>
          {/* Smart Match Strip (Stage 4 Automated Recommendations) */}
          {smartMatches.length > 0 && (
            <section className="rounded-2xl bg-[#272F31] text-white p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-bold">{t.factory.smartMatches}</h2>
                </div>
                <span className="text-xs text-slate-300">
                  Ranked by material affinity, industrial corridor distance & purity grade
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                {smartMatches.map((lot) => (
                  <div
                    key={lot.id}
                    className="rounded-xl bg-white/8 border border-white/12 p-4 flex flex-col justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-bold text-emerald-300">
                          {lot.smartMatchScore}% Match
                        </span>
                        <span className="font-mono text-slate-300">{lot.distanceKm} km away</span>
                      </div>
                      <h3 className="text-sm font-bold text-white mt-1.5">{lot.materialSubtype}</h3>
                      <p className="text-xs text-slate-300 mt-0.5">
                        {lang === 'ar' ? lot.hub.nameAr : lot.hub.nameEn} · {lot.purityGrade}
                      </p>
                      {lot.matchReasons?.length > 0 && (
                        <p className="text-[11px] text-emerald-200/90 mt-2">
                          {lot.matchReasons.join(' · ')}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-white/10">
                      <div className="font-mono tabular-nums text-xs">
                        <span className="font-bold text-white">{lot.availableTons.toFixed(1)} t</span>
                        <span className="text-slate-400 mx-1">·</span>
                        <span className="text-emerald-300">
                          {lot.pricePerTonEgp.toLocaleString()} EGP/t
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={!canReserve}
                        onClick={() => openBookingDrawer(lot)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        <span>Reserve</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Filters + View Switcher Bar */}
          <div className="rounded-xl bg-white border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                aria-label="Filter by Material Category"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-[#272F31]"
              >
                <option value="all">All Materials</option>
                {(Object.keys(MATERIAL_METADATA) as MaterialCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {MATERIAL_METADATA[cat][lang]}
                  </option>
                ))}
              </select>

              <select
                value={hubTypeFilter}
                onChange={(e) => setHubTypeFilter(e.target.value)}
                aria-label="Filter by Generator Type"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-[#272F31]"
              >
                <option value="all">All Generator Types</option>
                {(Object.keys(HUB_TYPE_LABELS) as HubType[]).map((ht) => (
                  <option key={ht} value={ht}>
                    {HUB_TYPE_LABELS[ht][lang]}
                  </option>
                ))}
              </select>

              <select
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
                aria-label="Filter by Purity Grade"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-[#272F31]"
              >
                <option value="all">All Purity Grades</option>
                <option value="Grade A">Grade A</option>
                <option value="Grade B">Grade B</option>
                <option value="Grade C">Grade C</option>
              </select>

              <select
                value={govFilter}
                onChange={(e) => setGovFilter(e.target.value)}
                aria-label="Filter by Governorate"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-[#272F31]"
              >
                <option value="all">All Governorates</option>
                {GOVERNORATES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            {/* Cards / Table / Live Google Map Switcher */}
            <div className="inline-flex items-center p-1 rounded-lg bg-slate-100">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  viewMode === 'cards'
                    ? 'bg-white text-[#272F31] shadow-xs'
                    : 'text-slate-600 hover:text-[#272F31]'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>{t.factory.viewCards}</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  viewMode === 'table'
                    ? 'bg-white text-[#272F31] shadow-xs'
                    : 'text-slate-600 hover:text-[#272F31]'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>{t.factory.viewTable}</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('map')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  viewMode === 'map'
                    ? 'bg-white text-[#272F31] shadow-xs'
                    : 'text-slate-600 hover:text-[#272F31]'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
                <span>{t.factory.viewMap}</span>
              </button>
            </div>
          </div>

          {/* Marketplace Content Views */}
          {loading ? (
            <div className="py-16 flex items-center justify-center text-slate-500 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
              <span className="text-sm font-medium">Loading verified lots...</span>
            </div>
          ) : filteredLots.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white py-14 text-center space-y-2">
              <Package className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-[#272F31]">
                No verified material lots match your current filters.
              </p>
              <button
                type="button"
                onClick={() => {
                  setCatFilter('all');
                  setHubTypeFilter('all');
                  setGradeFilter('all');
                  setGovFilter('all');
                }}
                className="text-xs font-semibold text-emerald-700 hover:underline"
              >
                Reset all filters
              </button>
            </div>
          ) : viewMode === 'cards' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredLots.map((lot) => (
                <article
                  key={lot.id}
                  className="rounded-2xl bg-white border border-slate-200 overflow-hidden flex flex-col justify-between hover:border-emerald-500/50 transition-colors"
                >
                  <div>
                    <div className="aspect-[16/10] bg-slate-100 overflow-hidden relative">
                      <img
                        src={
                          lot.photoUrl ||
                          MATERIAL_METADATA[lot.materialCategory as MaterialCategory]?.defaultPhoto
                        }
                        alt={lot.materialSubtype}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-5 space-y-2.5">
                      {/* Clean unboxed metadata (zero pill sandwiches) */}
                      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-semibold text-emerald-700">
                          {lot.passportCode}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{lot.purityGrade}</span>
                        <span aria-hidden="true">·</span>
                        <span>{lot.hub.governorate}</span>
                      </div>

                      <h3 className="text-base font-bold text-[#272F31] leading-snug">
                        {lot.materialSubtype}
                      </h3>

                      <p className="text-xs text-slate-600">
                        {lang === 'ar' ? lot.hub.nameAr : lot.hub.nameEn} (
                        {HUB_TYPE_LABELS[lot.hub.hubType as HubType]?.[lang] || lot.hub.hubType})
                      </p>

                      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 font-mono tabular-nums">
                        <div>
                          <p className="text-[11px] font-sans text-slate-500">Available Stock</p>
                          <p className="text-base font-bold text-[#272F31]">
                            {lot.availableTons.toFixed(2)} t
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] font-sans text-slate-500">Rate</p>
                          <p className="text-base font-bold text-emerald-700">
                            {lot.pricePerTonEgp.toLocaleString()} EGP/t
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 pb-5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onInspectPassport(lot.passportCode)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-[#272F31] hover:bg-slate-50 transition-colors min-h-[40px]"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>Passport</span>
                    </button>
                    <button
                      type="button"
                      disabled={!canReserve || lot.availableTons < 1}
                      onClick={() => openBookingDrawer(lot)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-45 disabled:cursor-not-allowed min-h-[40px]"
                    >
                      <span>{t.factory.reserveMaterial}</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : viewMode === 'table' ? (
            <div className="rounded-2xl bg-white border border-slate-200 overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-3 px-4 font-semibold">Passport ID</th>
                    <th className="py-3 px-4 font-semibold">Material & Grade</th>
                    <th className="py-3 px-4 font-semibold">Waste Generator</th>
                    <th className="py-3 px-4 font-semibold text-right">Match</th>
                    <th className="py-3 px-4 font-semibold text-right">Available (t)</th>
                    <th className="py-3 px-4 font-semibold text-right">EGP / Ton</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLots.map((lot) => (
                    <tr key={lot.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono font-semibold text-emerald-700">
                        <button
                          type="button"
                          onClick={() => onInspectPassport(lot.passportCode)}
                          className="hover:underline"
                        >
                          {lot.passportCode}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[#272F31]">{lot.materialSubtype}</div>
                        <div className="text-slate-500">
                          {MATERIAL_METADATA[lot.materialCategory as MaterialCategory]?.[lang]} ·{' '}
                          {lot.purityGrade}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-[#272F31]">
                          {lang === 'ar' ? lot.hub.nameAr : lot.hub.nameEn}
                        </div>
                        <div className="text-slate-500">
                          {HUB_TYPE_LABELS[lot.hub.hubType as HubType]?.[lang]} ·{' '}
                          {lot.hub.governorate}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-emerald-700">
                        {lot.smartMatchScore}%
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-[#272F31]">
                        {lot.availableTons.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-[#272F31]">
                        {lot.pricePerTonEgp.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          disabled={!canReserve || lot.availableTons < 1}
                          onClick={() => openBookingDrawer(lot)}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          <span>Reserve</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <HubMarketplaceMap
              lots={filteredLots}
              lang={lang}
              canReserve={canReserve}
              onReserveClick={openBookingDrawer}
              onInspectPassport={onInspectPassport}
            />
          )}
        </>
      ) : (
        /* Factory Reservations & 3PL Tracking Table */
        <div className="rounded-2xl bg-white border border-slate-200 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="py-3 px-4 font-semibold">Reservation / Passport</th>
                <th className="py-3 px-4 font-semibold">Material & Generator</th>
                <th className="py-3 px-4 font-semibold">Certified 3PL Provider</th>
                <th className="py-3 px-4 font-semibold text-right">Qty (t)</th>
                <th className="py-3 px-4 font-semibold text-right">Total (EGP)</th>
                <th className="py-3 px-4 font-semibold">Custody Status</th>
                <th className="py-3 px-4 font-semibold text-right">Est./Sealed CO2e</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {myReservations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    No reservations yet. Reserve verified tonnage from the Marketplace to dispatch 3PL pickup.
                  </td>
                </tr>
              ) : (
                myReservations.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-4 font-mono">
                      <div className="font-bold text-[#272F31]">{r.reservationCode}</div>
                      <button
                        type="button"
                        onClick={() => onInspectPassport(r.passportCode)}
                        className="text-emerald-700 hover:underline text-[11px]"
                      >
                        {r.passportCode} (Stage {r.currentStage}/7)
                      </button>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-[#272F31]">{r.materialSubtype}</div>
                      <div className="text-slate-500">
                        {r.hubNameEn} · {r.hubGovernorate}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-[#272F31] flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>{r.providerNameEn}</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        License: {r.providerLicenseId}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold">
                      {r.quantityTons.toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-[#272F31]">
                      {r.totalEgp.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-emerald-700">
                      {PICKUP_STATUS_LABELS[r.pickupStatus as PickupStatus]?.[lang] ||
                        r.pickupStatus}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-emerald-700">
                      {r.co2eAvoidedTons.toFixed(2)} tCO2e
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Transactional Atomic Booking Slide-Over Drawer */}
      {bookingLot && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-[#272F31]/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl flex flex-col justify-between">
            <form onSubmit={handleConfirmBooking} className="p-6 space-y-5 flex-1">
              <div className="flex items-center justify-between pb-4 border-b border-slate-200">
                <div>
                  <p className="text-xs font-mono font-semibold text-emerald-700">
                    {bookingLot.passportCode}
                  </p>
                  <h2 className="text-lg font-bold text-[#272F31]">Atomic Material Reservation</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setBookingLot(null)}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                  aria-label="Close drawer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="rounded-xl bg-[#F8FAFC] border border-slate-200 p-4 space-y-1.5 text-xs">
                <p className="font-bold text-sm text-[#272F31]">{bookingLot.materialSubtype}</p>
                <p className="text-slate-600">
                  {bookingLot.hub.nameEn} · {bookingLot.hub.governorate}
                </p>
                <p className="font-mono text-slate-700">
                  Verified Available: <strong>{bookingLot.availableTons.toFixed(2)} metric tons</strong> ·{' '}
                  {bookingLot.pricePerTonEgp.toLocaleString()} EGP/t
                </p>
              </div>

              {bookingError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {bookingError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Reservation Quantity (Metric Tons — Min 1.0 t, Max{' '}
                  {bookingLot.availableTons.toFixed(2)} t)
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={bookingLot.availableTons}
                  step={0.1}
                  value={qtyTons}
                  onChange={(e) => setQtyTons(Number(e.target.value))}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-mono font-bold text-[#272F31] focus:border-emerald-600 focus:outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">{t.factory.minTonNotice}</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Preferred 3PL Pickup Slot
                </label>
                <input
                  type="text"
                  required
                  value={pickupWindow}
                  onChange={(e) => setPickupWindow(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-[#272F31] focus:border-emerald-600 focus:outline-none"
                />
              </div>

              {/* Financial & ESG Impact Preview */}
              <div className="rounded-xl bg-[#272F31] text-white p-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-300">Rate × Quantity</span>
                  <span className="font-mono tabular-nums">
                    {bookingLot.pricePerTonEgp.toLocaleString()} × {qtyTons.toFixed(2)} t
                  </span>
                </div>
                <div className="flex justify-between text-base font-bold pt-2 border-t border-white/15">
                  <span>Total Contract Value</span>
                  <span className="font-mono tabular-nums text-emerald-400">
                    {Math.round(qtyTons * bookingLot.pricePerTonEgp).toLocaleString()} EGP
                  </span>
                </div>
                <div className="flex justify-between text-emerald-200 pt-1">
                  <span>Projected Avoided Emissions</span>
                  <span className="font-mono tabular-nums font-semibold">
                    {(qtyTons * bookingLot.co2eFactorPerTon).toFixed(2)} tCO2e
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 pt-2">
                  Confirming locks stock atomically, advances Passport to Stage 5, and dispatches a
                  certified 3PL carrier automatically.
                </p>
              </div>

              <button
                type="submit"
                disabled={bookingSubmitting || qtyTons < 1 || qtyTons > bookingLot.availableTons}
                className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors disabled:opacity-50"
              >
                {bookingSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <span>{t.factory.confirmReservation}</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

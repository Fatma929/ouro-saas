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
  Scale,
  Recycle,
  Settings,
  Flag,
  Upload,
} from 'lucide-react';
import { apiFetch, generateIdempotencyKey } from '../lib/api.ts';
import { HubMarketplaceMap } from './maps/HubMarketplaceMap.tsx';
import { LifecycleBadge } from './ui/DesignSystem.tsx';
import { DisputeModal } from './DisputeModal.tsx';
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

  const [section, setSection] = useState<'marketplace' | 'reservations' | 'profile'>('marketplace');
  const [viewMode, setViewMode] = useState<'cards' | 'table' | 'map'>('cards');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [factory, setFactory] = useState<any>(user.factory || null);
  const [kpis, setKpis] = useState({
    totalAvailableTons: 0,
    activeHubsCount: 0,
    activeReservationsCount: 0,
    deliveredPendingTons: 0,
    verifiedRecycledTons: 0,
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

  // Physical Receipt Confirmation Modal State
  const [receiveTarget, setReceiveTarget] = useState<any>(null);
  const [receivedWeightKg, setReceivedWeightKg] = useState<number>(0);
  const [weighbridgeFileId, setWeighbridgeFileId] = useState<number | null>(null);
  const [weighbridgeFileName, setWeighbridgeFileName] = useState<string | null>(null);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  // Verified Recycling Outcome Modal State (Stage 7)
  const [recycleTarget, setRecycleTarget] = useState<any>(null);
  const [recoveredTons, setRecoveredTons] = useState<number>(0);
  const [residualTons, setResidualTons] = useState<number>(0);
  const [lossTons, setLossTons] = useState<number>(0);
  const [recyclingNotes, setRecyclingNotes] = useState('');
  const [recyclingEvidenceFileId, setRecyclingEvidenceFileId] = useState<number | null>(null);
  const [recyclingEvidenceName, setRecyclingEvidenceName] = useState<string | null>(null);

  // Factory Profile Editor State
  const [profileCats, setProfileCats] = useState<string[]>(['paper_cardboard', 'plastics']);
  const [profileCapacity, setProfileCapacity] = useState<number>(120);
  const [profileNotes, setProfileNotes] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Dispute Modal State
  const [disputeTarget, setDisputeTarget] = useState<{
    reservationId: number;
    passportId: number;
    label: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mkt, resList] = await Promise.all([
        apiFetch('/api/marketplace/lots'),
        apiFetch('/api/factory/reservations'),
      ]);
      const fac = mkt.factory || user.factory || null;
      setFactory(fac);
      if (fac) {
        try {
          setProfileCats(JSON.parse(fac.preferredCategories || '["paper_cardboard","plastics"]'));
        } catch {
          setProfileCats(['paper_cardboard', 'plastics']);
        }
        setProfileCapacity(fac.monthlyCapacityTons || 120);
        setProfileNotes(fac.procurementNotes || '');
      }
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
        idempotencyKey: generateIdempotencyKey('res'),
        body: JSON.stringify({
          passportId: bookingLot.id,
          quantityTons: qtyTons,
          pickupWindow,
        }),
      });
      setToast(
        `Reservation ${res.reservation.reservationCode} locked (${qtyTons} t) — External 3PL ${res.provider.nameEn} assigned.`
      );
      setBookingLot(null);
      await loadData();
    } catch (err: any) {
      setBookingError(err.message || 'Reservation failed.');
    } finally {
      setBookingSubmitting(false);
    }
  };

  const handleCancelReservation = async (r: any) => {
    setActionBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/reservations/${r.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Cancelled by procurement team prior to 3PL pickup.' }),
      });
      setToast(`Reservation ${r.reservationCode} cancelled; ${r.quantityTons} t released back to marketplace.`);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Could not cancel reservation.');
    } finally {
      setActionBusy(false);
    }
  };

  const uploadEvidenceFile = async (
    file: File,
    purpose: 'weighbridge_ticket' | 'recycling_evidence'
  ): Promise<{ id: number; originalName: string }> => {
    setUploadingEvidence(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', purpose);
      return await apiFetch<{ id: number; originalName: string }>('/api/storage/upload', {
        method: 'POST',
        body: formData,
      });
    } finally {
      setUploadingEvidence(false);
    }
  };

  const openReceiveModal = (r: any) => {
    setReceiveTarget(r);
    setReceivedWeightKg(r.receivedWeightKg || r.handoffWeightKg || Math.round(r.quantityTons * 1000));
    setWeighbridgeFileId(r.weighbridgeFileId || null);
    setWeighbridgeFileName(r.weighbridgeFileName || null);
  };

  const handleConfirmReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiveTarget) return;
    setActionBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/reservations/${receiveTarget.id}/receive`, {
        method: 'POST',
        body: JSON.stringify({
          receivedWeightKg,
          weighbridgeFileId,
          weighbridgeFileName,
        }),
      });
      setToast(
        `Weighbridge receipt confirmed (${receivedWeightKg.toLocaleString()} kg). Status remains DELIVERED until recycling outcome is verified.`
      );
      setReceiveTarget(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Receipt confirmation failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const openRecycleModal = (r: any) => {
    const delivTons = r.receivedWeightKg
      ? Number((r.receivedWeightKg / 1000).toFixed(3))
      : r.handoffWeightKg
      ? Number((r.handoffWeightKg / 1000).toFixed(3))
      : r.quantityTons;
    setRecycleTarget({ ...r, _deliveredTonsBasis: delivTons });
    setRecoveredTons(Number((delivTons * 0.94).toFixed(2)));
    setResidualTons(Number((delivTons * 0.04).toFixed(2)));
    setLossTons(Number((delivTons * 0.02).toFixed(2)));
    setRecyclingNotes('');
    setRecyclingEvidenceFileId(null);
    setRecyclingEvidenceName(null);
  };

  const handleConfirmRecycle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recycleTarget) return;
    setActionBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/reservations/${recycleTarget.id}/recycle`, {
        method: 'POST',
        body: JSON.stringify({
          recoveredTons,
          residualTons,
          lossTons,
          recyclingEvidenceFileId,
          recyclingEvidenceName,
          recyclingNotes,
        }),
      });
      setToast(
        `Stage 7 Verified Recycling Sealed for ${recycleTarget.passportCode}: ${res.impact.recoveredTons} t recovered · Net ${res.impact.netVerifiedCo2eTons} tCO2e avoided (after −${res.impact.transportEmissionsTons} t freight).`
      );
      setRecycleTarget(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Recycling verification failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setError(null);
    try {
      await apiFetch('/api/factory/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          preferredCategories: profileCats,
          monthlyCapacityTons: profileCapacity,
          procurementNotes: profileNotes,
        }),
      });
      setToast('Recycling facility procurement profile updated. Smart Match scores refreshed.');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Could not update facility profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const toggleProfileCat = (cat: string) => {
    setProfileCats((prev) =>
      prev.includes(cat) ? (prev.length > 1 ? prev.filter((c) => c !== cat) : prev) : [...prev, cat]
    );
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
          <button type="button" onClick={() => setToast(null)}>
            <X className="w-4 h-4 text-emerald-800" />
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
            <button
              type="button"
              onClick={() => setSection('profile')}
              className={`inline-flex items-center gap-1 px-3 py-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                section === 'profile'
                  ? 'bg-white text-[#272F31] shadow-xs'
                  : 'text-slate-600 hover:text-[#272F31]'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Facility Profile</span>
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

      {/* Top 4-Column KPI Strip — Strictly Separating Delivered Pending vs Verified Recycled */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl bg-white border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Available Marketplace Stock</p>
          <p className="text-2xl font-extrabold font-mono tabular-nums text-[#272F31] mt-1">
            {kpis.totalAvailableTons.toFixed(1)} t
          </p>
        </div>
        <div className="rounded-xl bg-amber-50/40 border border-amber-200 p-4">
          <p className="text-xs font-medium text-amber-800">Delivered (Pending Verification)</p>
          <p className="text-2xl font-extrabold font-mono tabular-nums text-amber-900 mt-1">
            {Number(kpis.deliveredPendingTons || 0).toFixed(2)} t
          </p>
        </div>
        <div className="rounded-xl bg-emerald-50/40 border border-emerald-200 p-4">
          <p className="text-xs font-medium text-emerald-800">Verified Recycled Output</p>
          <p className="text-2xl font-extrabold font-mono tabular-nums text-emerald-800 mt-1">
            {Number(kpis.verifiedRecycledTons || 0).toFixed(2)} t
          </p>
        </div>
        <div className="rounded-xl bg-white border border-emerald-200 p-4">
          <p className="text-xs font-medium text-emerald-800">Verified Net CO2e Avoided</p>
          <p className="text-2xl font-extrabold font-mono tabular-nums text-emerald-700 mt-1">
            {kpis.verifiedCo2eTons.toFixed(2)} tCO2e
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {section === 'marketplace' ? (
        <>
          {/* Smart Match Strip */}
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

            <div className="inline-flex items-center p-1 rounded-lg bg-slate-100">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  viewMode === 'cards' ? 'bg-white text-[#272F31] shadow-xs' : 'text-slate-600'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>{t.factory.viewCards}</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  viewMode === 'table' ? 'bg-white text-[#272F31] shadow-xs' : 'text-slate-600'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>{t.factory.viewTable}</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('map')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  viewMode === 'map' ? 'bg-white text-[#272F31] shadow-xs' : 'text-slate-600'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
                <span>{t.factory.viewMap}</span>
              </button>
            </div>
          </div>

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
                          {HUB_TYPE_LABELS[lot.hub.hubType as HubType]?.[lang]} · {lot.hub.governorate}
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
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-45"
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
      ) : section === 'reservations' ? (
        /* Factory Reservations: Receipt Confirmation & Stage 7 Verified Recycling Outcomes */
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3 text-xs text-amber-900">
            <strong>Strict ESG Chain-of-Custody Rule:</strong> Delivered shipments remain{' '}
            <strong>DELIVERED</strong> (0 verified CO2e) until your facility records verified{' '}
            <strong>Recovered Output, Residual, and Loss</strong> below to seal Stage 7 (<strong>RECYCLED</strong>).
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-3 px-4 font-semibold">Reservation / Passport</th>
                  <th className="py-3 px-4 font-semibold">Material & Generator</th>
                  <th className="py-3 px-4 font-semibold">3PL Carrier</th>
                  <th className="py-3 px-4 font-semibold text-right">Qty / Value</th>
                  <th className="py-3 px-4 font-semibold">Status & Verification</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myReservations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500">
                      No reservations yet. Reserve verified tonnage from the Marketplace to dispatch 3PL pickup.
                    </td>
                  </tr>
                ) : (
                  myReservations.map((r) => {
                    const canCancel =
                      r.pickupStatus !== 'picked_up' &&
                      r.pickupStatus !== 'delivered' &&
                      r.pickupStatus !== 'cancelled';
                    const isDelivered = r.pickupStatus === 'delivered';
                    const isVerifiedRecycled = r.recyclingStatus === 'verified_recycled';

                    return (
                      <tr key={r.id} className="hover:bg-slate-50/70 align-top">
                        <td className="py-3.5 px-4 font-mono">
                          <div className="font-bold text-[#272F31]">{r.reservationCode}</div>
                          <button
                            type="button"
                            onClick={() => onInspectPassport(r.passportCode)}
                            className="text-emerald-700 hover:underline text-[11px]"
                          >
                            {r.passportCode} (Stage {r.currentStage}/7)
                          </button>
                          <div className="mt-1">
                            <LifecycleBadge
                              status={isVerifiedRecycled ? 'RECYCLED' : isDelivered ? 'DELIVERED' : 'LISTED'}
                              lang={lang}
                            />
                          </div>
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
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                          <div className="font-bold text-[#272F31]">{r.quantityTons.toFixed(2)} t</div>
                          <div className="text-slate-500">{r.totalEgp.toLocaleString()} EGP</div>
                        </td>
                        <td className="py-3.5 px-4 space-y-1">
                          <div className="font-semibold text-[#272F31]">
                            3PL: {PICKUP_STATUS_LABELS[r.pickupStatus as PickupStatus]?.[lang] || r.pickupStatus}
                          </div>
                          {isDelivered && (
                            <div className="text-[11px] text-slate-600">
                              Receipt:{' '}
                              {r.receiptStatus === 'received'
                                ? `Confirmed (${Number(r.receivedWeightKg || 0).toLocaleString()} kg)`
                                : 'Awaiting Weighbridge'}
                            </div>
                          )}
                          {isVerifiedRecycled ? (
                            <div className="text-[11px] font-mono font-bold text-emerald-700">
                              Recycled: {r.recoveredTons} t · Net {r.co2eAvoidedTons} tCO2e ({r.esgConfidenceLevel})
                            </div>
                          ) : (
                            <div className="text-[11px] font-mono text-slate-500">
                              Est. potential: ~{Number(r.estimatedCo2eTons || 0).toFixed(2)} tCO2e (unverified)
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex flex-col items-end gap-1.5">
                            {isDelivered && r.receiptStatus !== 'received' && (
                              <button
                                type="button"
                                onClick={() => openReceiveModal(r)}
                                className="inline-flex items-center gap-1 rounded-lg bg-[#272F31] hover:bg-[#333D40] px-2.5 py-1.5 text-[11px] font-semibold text-white whitespace-nowrap"
                              >
                                <Scale className="w-3 h-3 text-amber-300" />
                                <span>Confirm Receipt</span>
                              </button>
                            )}
                            {isDelivered && !isVerifiedRecycled && (
                              <button
                                type="button"
                                onClick={() => openRecycleModal(r)}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1.5 text-[11px] font-semibold text-white whitespace-nowrap"
                              >
                                <Recycle className="w-3 h-3" />
                                <span>Verify Recycling (Stage 7)</span>
                              </button>
                            )}
                            {canCancel && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => handleCancelReservation(r)}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1 text-[11px] font-semibold text-red-700 whitespace-nowrap"
                              >
                                <span>Cancel</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setDisputeTarget({
                                  reservationId: r.id,
                                  passportId: r.passportId,
                                  label: `${r.reservationCode} / ${r.passportCode}`,
                                })
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-amber-800"
                            >
                              <Flag className="w-3 h-3" />
                              <span>Report Issue</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Recycling Facility Procurement Profile */
        <form
          onSubmit={handleSaveProfile}
          className="rounded-2xl bg-white border border-slate-200 p-6 max-w-2xl space-y-5"
        >
          <div>
            <h2 className="text-base font-bold text-[#272F31]">
              Facility Intake & Smart Match Procurement Profile
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Customize accepted material streams and monthly tonnage capacity to tailor Smart Match rankings.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Accepted Non-Hazardous Material Streams
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(MATERIAL_METADATA) as MaterialCategory[]).map((cat) => {
                const selected = profileCats.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleProfileCat(cat)}
                    className={`rounded-xl border px-3.5 py-2.5 text-left text-xs font-semibold transition-colors ${
                      selected
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {MATERIAL_METADATA[cat][lang]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Monthly Processing Capacity (Metric Tons / Month)
            </label>
            <input
              type="number"
              min={10}
              max={50000}
              value={profileCapacity}
              onChange={(e) => setProfileCapacity(Number(e.target.value) || 100)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-mono font-bold text-[#272F31]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Receiving & Quality Requirements Notes
            </label>
            <textarea
              rows={3}
              value={profileNotes}
              onChange={(e) => setProfileNotes(e.target.value)}
              placeholder="e.g., Baled OCC moisture max 10%, weighbridge open 07:00-18:00 EET..."
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-[#272F31]"
            />
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white"
          >
            {savingProfile && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Save Procurement Profile</span>
          </button>
        </form>
      )}

      {/* Transactional Atomic Booking Slide-Over Drawer */}
      {bookingLot && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#272F31]/60 backdrop-blur-xs" role="dialog" aria-modal="true">
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
                  Reservation Quantity (Metric Tons — Min 1.0 t, Max {bookingLot.availableTons.toFixed(2)} t)
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={bookingLot.availableTons}
                  step={0.1}
                  value={qtyTons}
                  onChange={(e) => setQtyTons(Number(e.target.value))}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-mono font-bold text-[#272F31]"
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
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-[#272F31]"
                />
              </div>

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
                <div className="flex justify-between text-amber-200 pt-1">
                  <span>Est. Pre-Recycling CO2e Potential</span>
                  <span className="font-mono tabular-nums font-semibold">
                    ~{(qtyTons * bookingLot.co2eFactorPerTon).toFixed(2)} tCO2e
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 pt-2">
                  Row-locked atomic reservation prevents double-booking and assigns a certified external 3PL. Verified CO2e is sealed only after Stage 7 recycling verification.
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

      {/* Confirm Physical Weighbridge Receipt Modal (Stage 6) */}
      {receiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#272F31]/65 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleConfirmReceipt}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-amber-800">Stage 6 — Physical Intake</p>
                <h3 className="text-base font-bold text-[#272F31]">
                  Confirm Facility Receipt ({receiveTarget.reservationCode})
                </h3>
              </div>
              <button type="button" onClick={() => setReceiveTarget(null)}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Actual Weighbridge Intake Weight (kg)
              </label>
              <input
                type="number"
                required
                min={50}
                value={receivedWeightKg}
                onChange={(e) => setReceivedWeightKg(Number(e.target.value) || 0)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-mono font-bold text-[#272F31]"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                3PL Handoff Weight: {(receiveTarget.handoffWeightKg || receiveTarget.quantityTons * 1000).toLocaleString()} kg
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Weighbridge Ticket / Intake Slip (Optional)
              </label>
              <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 cursor-pointer text-xs font-semibold text-[#272F31]">
                {uploadingEvidence ? (
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                ) : (
                  <Upload className="w-4 h-4 text-emerald-600" />
                )}
                <span>{weighbridgeFileName || 'Upload Weighbridge PDF / Image'}</span>
                <input
                  type="file"
                  accept=".pdf,.txt,image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const up = await uploadEvidenceFile(f, 'weighbridge_ticket');
                      setWeighbridgeFileId(up.id);
                      setWeighbridgeFileName(up.originalName);
                    } catch (err: any) {
                      setError(err.message || 'Upload failed.');
                    }
                  }}
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={actionBusy || uploadingEvidence}
              className="w-full min-h-[44px] rounded-xl bg-[#272F31] hover:bg-[#333D40] text-white font-bold text-xs"
            >
              {actionBusy ? 'Recording Receipt...' : 'Confirm Physical Receipt (Status stays DELIVERED)'}
            </button>
          </form>
        </div>
      )}

      {/* Record Verified Recycling Outcome Modal (Stage 7 — DELIVERED -> RECYCLED) */}
      {recycleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#272F31]/65 p-4 overflow-y-auto" role="dialog" aria-modal="true">
          <form
            onSubmit={handleConfirmRecycle}
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <p className="text-xs font-semibold text-emerald-700">Stage 7 — Verified Recycling Outcome</p>
                <h3 className="text-base font-bold text-[#272F31]">
                  Seal Verified Recycling ({recycleTarget.passportCode})
                </h3>
              </div>
              <button type="button" onClick={() => setRecycleTarget(null)}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700">
              Delivered Mass Basis:{' '}
              <strong className="font-mono text-[#272F31]">
                {Number(recycleTarget._deliveredTonsBasis).toFixed(3)} metric tons
              </strong>
              . Net CO2e will be calculated strictly on <strong>Recovered Output</strong> minus 3PL road freight emissions.
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-emerald-800 mb-1">
                  Recovered Output (t)
                </label>
                <input
                  type="number"
                  required
                  min={0.01}
                  step={0.01}
                  value={recoveredTons}
                  onChange={(e) => setRecoveredTons(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-emerald-300 px-3 py-2 text-sm font-mono font-bold text-emerald-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Residual Waste (t)
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={residualTons}
                  onChange={(e) => setResidualTons(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono font-bold text-[#272F31]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Process Loss (t)
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={lossTons}
                  onChange={(e) => setLossTons(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono font-bold text-[#272F31]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Recycling Processing Evidence (Batch Log / Certificate — Upgrades ESG Confidence to VERIFIED)
              </label>
              <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 px-3 py-3 cursor-pointer text-xs font-semibold text-emerald-900">
                {uploadingEvidence ? (
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                ) : (
                  <Upload className="w-4 h-4 text-emerald-600" />
                )}
                <span>{recyclingEvidenceName || 'Upload Recycling Proof (PDF / Image / TXT)'}</span>
                <input
                  type="file"
                  accept=".pdf,.txt,image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const up = await uploadEvidenceFile(f, 'recycling_evidence');
                      setRecyclingEvidenceFileId(up.id);
                      setRecyclingEvidenceName(up.originalName);
                    } catch (err: any) {
                      setError(err.message || 'Upload failed.');
                    }
                  }}
                />
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Processing & Recovery Notes
              </label>
              <textarea
                rows={2}
                value={recyclingNotes}
                onChange={(e) => setRecyclingNotes(e.target.value)}
                placeholder="e.g., Washed PET flake output batch #402; moisture & labels separated as residual."
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-[#272F31]"
              />
            </div>

            <button
              type="submit"
              disabled={actionBusy || uploadingEvidence || recoveredTons <= 0}
              className="w-full min-h-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm disabled:opacity-50"
            >
              {actionBusy ? 'Verifying & Sealing ESG...' : 'Verify Recycling Outcome & Seal Stage 7'}
            </button>
          </form>
        </div>
      )}

      {/* Dispute Modal */}
      <DisputeModal
        open={Boolean(disputeTarget)}
        lang={lang}
        reservationId={disputeTarget?.reservationId}
        passportId={disputeTarget?.passportId}
        referenceLabel={disputeTarget?.label}
        onClose={() => setDisputeTarget(null)}
        onSubmitted={() =>
          setToast('Dispute submitted to OURO Platform Operations for investigation.')
        }
      />
    </div>
  );
};

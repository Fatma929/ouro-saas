import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Truck,
  ShieldCheck,
  ScanLine,
  CheckCircle2,
  MapPin,
  ArrowRight,
  Scale,
  AlertTriangle,
  Loader2,
  X,
  Upload,
  Plus,
  FileCheck2,
  Flag,
} from 'lucide-react';
import { apiFetch, downloadSignedPrivateFile } from '../lib/api.ts';
import { buildPassportQrUrl, extractPassportCodeFromScan } from '../lib/passport-qr.ts';
import { PassportQRScanner } from './PassportQRScanner.tsx';
import { DriverRouteMap, type RouteStop } from './maps/DriverRouteMap.tsx';
import { DisputeModal } from './DisputeModal.tsx';
import { LifecycleBadge } from './ui/DesignSystem.tsx';
import {
  PICKUP_STATUS_FLOW,
  PICKUP_STATUS_LABELS,
  VEHICLE_TYPES,
  type PickupStatus,
} from '../shared/constants.ts';
import { TRANSLATIONS, type Lang } from '../shared/i18n.ts';

interface Driver3plWorkspaceProps {
  user: any;
  lang: Lang;
  onInspectPassport: (code: string) => void;
}

export const Driver3plWorkspace: React.FC<Driver3plWorkspaceProps> = ({
  lang,
  onInspectPassport,
}) => {
  const t = TRANSLATIONS[lang];
  const [activeTab, setActiveTab] = useState<'manifest' | 'fleet'>('manifest');
  const [provider, setProvider] = useState<any>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // Accept Dispatch Modal (scheduled -> accepted with external 3PL vehicle assignment)
  const [acceptJob, setAcceptJob] = useState<any>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | ''>('');

  // Handoff QR + Weight Verification Modal (arrived -> picked_up)
  const [handoffJob, setHandoffJob] = useState<any>(null);
  const [qrInput, setQrInput] = useState('');
  const [qrScannedVerified, setQrScannedVerified] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [handoffWeightKg, setHandoffWeightKg] = useState<number>(0);
  const [handoffMethod, setHandoffMethod] = useState<'ble_scale' | 'manifest_confirmed'>(
    'manifest_confirmed'
  );
  const [handoffError, setHandoffError] = useState<string | null>(null);

  // Proof of Delivery (POD) Confirmation Modal (picked_up -> delivered, Stage 6)
  const [podJob, setPodJob] = useState<any>(null);
  const [podFileId, setPodFileId] = useState<number | null>(null);
  const [podFileName, setPodFileName] = useState<string | null>(null);
  const [uploadingPod, setUploadingPod] = useState(false);
  const [podError, setPodError] = useState<string | null>(null);

  // Dispute Modal
  const [disputeTarget, setDisputeTarget] = useState<{
    reservationId: number;
    passportId: number;
    label: string;
  } | null>(null);

  // New External 3PL Vehicle Form
  const [plateNumber, setPlateNumber] = useState('');
  const [vehicleType, setVehicleType] = useState<string>('box_truck');
  const [capacityTons, setCapacityTons] = useState<number>(12);
  const [envPermitNo, setEnvPermitNo] = useState('');
  const [permitExpiry, setPermitExpiry] = useState('2028-12-31');
  const [driverName, setDriverName] = useState('');
  const [savingVehicle, setSavingVehicle] = useState(false);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/driver/jobs');
      setProvider(data.provider || null);
      setVehicles(data.vehicles || []);
      setJobs(data.jobs || []);
    } catch (err: any) {
      setError(err.message || 'Could not load 3PL route manifest.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.pickupStatus !== 'delivered' && j.pickupStatus !== 'cancelled'),
    [jobs]
  );
  const completedJobs = useMemo(
    () => jobs.filter((j) => j.pickupStatus === 'delivered'),
    [jobs]
  );

  // Build ordered multi-stop waypoints for Google Maps Route.computeRoutes()
  const routeStops: RouteStop[] = useMemo(() => {
    if (activeJobs.length === 0) return [];
    const stops: RouteStop[] = activeJobs.map((j) => ({
      id: j.id,
      label: lang === 'ar' ? j.hub.nameAr : j.hub.nameEn,
      sublabel: `${j.quantityTons} t · ${j.passportCode}`,
      lat: j.hub.lat,
      lng: j.hub.lng,
      kind: 'pickup',
    }));
    const destFactory = activeJobs[0].factory;
    if (destFactory) {
      stops.push({
        id: destFactory.id,
        label: lang === 'ar' ? destFactory.nameAr : destFactory.nameEn,
        sublabel: destFactory.industrialZone,
        lat: destFactory.lat,
        lng: destFactory.lng,
        kind: 'factory',
      });
    }
    return stops;
  }, [activeJobs, lang]);

  const getNextStatus = (current: PickupStatus): PickupStatus | null => {
    const idx = PICKUP_STATUS_FLOW.indexOf(current);
    if (idx < 0 || idx >= PICKUP_STATUS_FLOW.length - 1) return null;
    return PICKUP_STATUS_FLOW[idx + 1];
  };

  const executeStatusUpdate = async (
    job: any,
    nextStatus: PickupStatus,
    extra: Record<string, unknown> = {}
  ) => {
    setUpdatingId(job.id);
    setError(null);
    setHandoffError(null);
    setPodError(null);
    try {
      await apiFetch(`/api/reservations/${job.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          nextStatus,
          gpsLat: nextStatus === 'delivered' ? job.factory.lat : job.hub.lat,
          gpsLng: nextStatus === 'delivered' ? job.factory.lng : job.hub.lng,
          ...extra,
        }),
      });
      setToast(
        nextStatus === 'delivered'
          ? `Stage 6 Delivery confirmed at ${job.factory.nameEn}. Passport ${job.passportCode} is now DELIVERED — awaiting recycling facility intake & Stage 7 verification.`
          : `Stop ${job.reservationCode} updated to "${PICKUP_STATUS_LABELS[nextStatus][lang]}".`
      );
      setAcceptJob(null);
      setHandoffJob(null);
      setPodJob(null);
      await loadJobs();
    } catch (err: any) {
      if (handoffJob) {
        setHandoffError(err.message || 'Handoff verification failed.');
      } else if (podJob) {
        setPodError(err.message || 'Delivery confirmation failed.');
      } else {
        setError(err.message || 'Status update failed.');
      }
    } finally {
      setUpdatingId(null);
    }
  };

  const handleAdvanceClick = (job: any) => {
    const next = getNextStatus(job.pickupStatus as PickupStatus);
    if (!next) return;
    if (next === 'accepted') {
      setAcceptJob(job);
      setSelectedVehicleId(vehicles[0]?.id ?? '');
      return;
    }
    if (next === 'picked_up') {
      setHandoffJob(job);
      setQrInput(job.passportCode);
      setQrScannedVerified(false);
      setScannerOpen(false);
      setHandoffWeightKg(Math.round(job.quantityTons * 1000));
      setHandoffMethod('manifest_confirmed');
      setHandoffError(null);
      return;
    }
    if (next === 'delivered') {
      setPodJob(job);
      setPodFileId(null);
      setPodFileName(null);
      setPodError(null);
      return;
    }
    executeStatusUpdate(job, next);
  };

  const handlePodUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPod(true);
    setPodError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', 'pod_document');
      const res = await apiFetch<{ id: number; originalName: string }>('/api/storage/upload', {
        method: 'POST',
        body: formData,
      });
      setPodFileId(res.id);
      setPodFileName(res.originalName);
    } catch (err: any) {
      setPodError(err.message || 'Could not upload Proof of Delivery document.');
    } finally {
      setUploadingPod(false);
    }
  };

  const handleRegisterVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingVehicle(true);
    setError(null);
    try {
      await apiFetch('/api/driver/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          plateNumber,
          vehicleType,
          capacityTons,
          envPermitNo,
          permitExpiry,
          driverName,
        }),
      });
      setToast(`Registered external 3PL vehicle ${plateNumber.toUpperCase()} (${envPermitNo.toUpperCase()}).`);
      setPlateNumber('');
      setEnvPermitNo('');
      setDriverName('');
      await loadJobs();
    } catch (err: any) {
      setError(err.message || 'Failed to register 3PL vehicle.');
    } finally {
      setSavingVehicle(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* 3PL Certified Carrier Header */}
      <div className="rounded-2xl bg-[#272F31] text-white p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-300 font-semibold">
            <Truck className="w-4 h-4" />
            <span>Certified External 3PL Partner · Asset-Light Coordination</span>
            {provider && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">
                  {t.driver.licenseBadge}: {provider.envTransportLicenseId}
                </span>
              </>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold">{t.driver.title}</h1>
          {provider && (
            <p className="text-xs text-slate-300">
              {lang === 'ar' ? provider.nameAr : provider.nameEn} · Registered Partner Vehicles:{' '}
              <span className="font-mono font-semibold text-white">{vehicles.length}</span> · On-Time Score:{' '}
              <span className="font-mono text-emerald-300 font-semibold">{provider.onTimeRate}%</span>
            </p>
          )}
          <p className="text-[11px] text-slate-400">
            Physical waste transport is executed strictly by licensed external 3PL carriers. OURO coordinates digital
            passports, route handoffs, and chain-of-custody verification only.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono shrink-0">
          <div>
            <span className="block text-slate-400">Active Stops</span>
            <span className="text-xl font-bold text-emerald-400 tabular-nums">{activeJobs.length}</span>
          </div>
          <div className="h-8 w-px bg-white/15" />
          <div>
            <span className="block text-slate-400">Delivered</span>
            <span className="text-xl font-bold text-white tabular-nums">{completedJobs.length}</span>
          </div>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-200/70">
        <button
          type="button"
          onClick={() => setActiveTab('manifest')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'manifest' ? 'bg-white text-[#272F31] shadow-xs' : 'text-slate-600 hover:text-[#272F31]'
          }`}
        >
          Route Manifest ({activeJobs.length} active)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('fleet')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTab === 'fleet' ? 'bg-white text-[#272F31] shadow-xs' : 'text-slate-600 hover:text-[#272F31]'
          }`}
        >
          External 3PL Fleet Registry ({vehicles.length})
        </button>
      </div>

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

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {activeTab === 'manifest' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Google Maps Traffic-Aware Multi-Stop Optimizer */}
          <div className="lg:col-span-7 space-y-4">
            <DriverRouteMap stops={routeStops} />
          </div>

          {/* Right: Active Stop Execution Manifest */}
          <div className="lg:col-span-5 space-y-4">
            <h2 className="text-base font-bold text-[#272F31]">{t.driver.activeStops}</h2>

            {loading ? (
              <div className="py-12 flex justify-center text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : activeJobs.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                All assigned 3PL pickups have been delivered. New factory reservations dispatched to your carrier will
                appear here automatically.
              </div>
            ) : (
              <div className="space-y-4">
                {activeJobs.map((job, idx) => {
                  const nextStatus = getNextStatus(job.pickupStatus as PickupStatus);
                  const curStepIdx = PICKUP_STATUS_FLOW.indexOf(job.pickupStatus as PickupStatus);
                  return (
                    <article
                      key={job.id}
                      className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-600 text-white font-mono font-bold text-[11px]">
                              {idx + 1}
                            </span>
                            <span className="font-mono font-bold text-[#272F31]">{job.passportCode}</span>
                            <span className="text-slate-400">·</span>
                            <span className="font-semibold text-emerald-700">
                              {PICKUP_STATUS_LABELS[job.pickupStatus as PickupStatus]?.[lang]}
                            </span>
                          </div>
                          <h3 className="text-base font-bold text-[#272F31] mt-1.5">
                            {lang === 'ar' ? job.hub.nameAr : job.hub.nameEn}
                          </h3>
                          <p className="text-xs text-slate-600 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>{job.hub.address}</span>
                          </p>
                          {job.vehicle && (
                            <p className="text-[11px] font-mono text-slate-500 mt-1">
                              Vehicle: <strong>{job.vehicle.plateNumber}</strong> ({job.vehicle.envPermitNo})
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onInspectPassport(job.passportCode)}
                          className="p-1.5 inline-flex items-center justify-center rounded-xl border border-slate-200 hover:border-emerald-600 bg-white shrink-0 transition-colors"
                          title="Open Digital Waste Passport QR"
                        >
                          <QRCodeSVG
                            value={buildPassportQrUrl(job.passportCode)}
                            size={44}
                            fgColor="#272F31"
                            bgColor="#FFFFFF"
                            level="M"
                          />
                        </button>
                      </div>

                      {/* Material & Destination Details */}
                      <div className="grid grid-cols-2 gap-3 text-xs pt-3 border-t border-slate-100">
                        <div>
                          <span className="text-slate-500 block">Cargo & Weight</span>
                          <span className="font-semibold text-[#272F31]">
                            {job.materialSubtype} ({job.purityGrade})
                          </span>
                          <span className="block font-mono font-bold text-emerald-700 mt-0.5">
                            {job.quantityTons.toFixed(2)} tons (
                            {Math.round(job.quantityTons * 1000).toLocaleString()} kg)
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Drop-Off Factory</span>
                          <span className="font-semibold text-[#272F31]">
                            {lang === 'ar' ? job.factory.nameAr : job.factory.nameEn}
                          </span>
                          <span className="block text-slate-500 mt-0.5">{job.factory.industrialZone}</span>
                        </div>
                      </div>

                      {/* 6-Step 3PL Logistics Progress Indicator */}
                      <div className="grid grid-cols-6 gap-1 pt-1">
                        {PICKUP_STATUS_FLOW.map((st, sIdx) => (
                          <div key={st} className="space-y-1">
                            <div
                              className={`h-1.5 rounded-full ${
                                sIdx <= curStepIdx ? 'bg-emerald-600' : 'bg-slate-200'
                              }`}
                            />
                            <span className="block text-[9px] text-slate-500 truncate">
                              {PICKUP_STATUS_LABELS[st][lang]}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2">
                        {nextStatus && (
                          <button
                            type="button"
                            disabled={updatingId === job.id}
                            onClick={() => handleAdvanceClick(job)}
                            className="flex-1 min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm px-3 transition-colors disabled:opacity-50"
                          >
                            {updatingId === job.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                <span>
                                  {nextStatus === 'accepted'
                                    ? 'Accept Dispatch & Assign Vehicle'
                                    : nextStatus === 'picked_up'
                                    ? t.driver.verifyQr
                                    : nextStatus === 'delivered'
                                    ? 'Confirm Factory Delivery & Upload POD (Stage 6)'
                                    : `Mark as ${PICKUP_STATUS_LABELS[nextStatus][lang]}`}
                                </span>
                                <ArrowRight className="w-4 h-4 shrink-0" />
                              </>
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setDisputeTarget({
                              reservationId: job.id,
                              passportId: job.passportId,
                              label: `${job.reservationCode} (${job.passportCode})`,
                            })
                          }
                          title="Report Operational Issue"
                          className="min-h-[46px] px-3 rounded-xl border border-slate-200 hover:border-amber-400 hover:bg-amber-50 text-slate-600 hover:text-amber-800 inline-flex items-center justify-center"
                        >
                          <Flag className="w-4 h-4" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {/* Completed Deliveries List (Strictly separates DELIVERED vs VERIFIED RECYCLED) */}
            {completedJobs.length > 0 && (
              <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
                <h3 className="text-sm font-bold text-[#272F31] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>{t.driver.completedStops}</span>
                </h3>
                <div className="divide-y divide-slate-100">
                  {completedJobs.slice(0, 8).map((c) => {
                    const isVerifiedRecycled = c.recyclingStatus === 'verified_recycled';
                    return (
                      <div key={c.id} className="py-3 flex items-start justify-between gap-2 text-xs">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onInspectPassport(c.passportCode)}
                              className="font-mono font-bold text-emerald-700 hover:underline"
                            >
                              {c.passportCode}
                            </button>
                            <LifecycleBadge
                              status={isVerifiedRecycled ? 'RECYCLED' : 'DELIVERED'}
                              lang={lang}
                            />
                          </div>
                          <p className="text-slate-600 truncate">
                            {c.hub.nameEn} → {c.factory.nameEn}
                          </p>
                          {c.podFileId && (
                            <button
                              type="button"
                              onClick={() =>
                                downloadSignedPrivateFile(c.podFileId, c.podFileName || `POD_${c.reservationCode}`)
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline"
                            >
                              <FileCheck2 className="w-3 h-3" />
                              <span>POD: {c.podFileName || 'Signed Document'}</span>
                            </button>
                          )}
                        </div>
                        <div className="text-right font-mono tabular-nums shrink-0">
                          <span className="font-bold text-[#272F31]">{c.quantityTons.toFixed(1)} t</span>
                          {isVerifiedRecycled ? (
                            <span className="block text-[11px] text-emerald-700 font-semibold">
                              +{Number(c.co2eAvoidedTons || 0).toFixed(2)} tCO2e verified
                            </span>
                          ) : (
                            <span className="block text-[10px] font-sans text-amber-700 font-medium">
                              Awaiting Recycler Verification
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* TAB 2: EXTERNAL 3PL FLEET REGISTRY */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div>
              <h2 className="text-base font-bold text-[#272F31]">Registered External 3PL Partner Vehicles</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Owned and operated by {provider?.nameEn || 'your certified 3PL company'}. OURO verifies environmental
                transport permits and links vehicle plates to Stage 6 Chain of Custody records.
              </p>
            </div>
            {vehicles.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No vehicles registered yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {vehicles.map((v) => (
                  <div key={v.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[#272F31] text-sm">{v.plateNumber}</span>
                        <span className="text-slate-400">·</span>
                        <span className="font-semibold text-emerald-700">
                          {VEHICLE_TYPES.find((vt) => vt.value === v.vehicleType)?.[lang] || v.vehicleType}
                        </span>
                      </div>
                      <p className="text-slate-600 font-mono">
                        Permit: <strong>{v.envPermitNo}</strong> · Expiry: {v.permitExpiry} · Driver:{' '}
                        {v.driverName || 'Assigned Driver'}
                      </p>
                    </div>
                    <div className="text-right font-mono shrink-0">
                      <span className="font-bold text-[#272F31]">{v.capacityTons} t cap</span>
                      <span className="block text-[11px] text-emerald-700 font-semibold">
                        {v.verificationStatus === 'verified' || v.isActive ? 'Permit Verified' : 'Pending'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={handleRegisterVehicle}
            className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-5 space-y-4"
          >
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-600" />
              <h2 className="text-sm font-bold text-[#272F31]">Register Partner Transport Vehicle</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">License Plate Number</label>
                <input
                  type="text"
                  required
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value)}
                  placeholder="e.g. EG-CAI-9421"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-[#272F31]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Vehicle Type</label>
                <select
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#272F31] bg-white"
                >
                  {VEHICLE_TYPES.map((vt) => (
                    <option key={vt.value} value={vt.value}>
                      {vt[lang]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Payload Capacity (tons)</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  step="0.5"
                  required
                  value={capacityTons}
                  onChange={(e) => setCapacityTons(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-[#272F31]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">WMRA / Env. Permit No.</label>
                <input
                  type="text"
                  required
                  value={envPermitNo}
                  onChange={(e) => setEnvPermitNo(e.target.value)}
                  placeholder="e.g. WMRA-VEH-2026-410"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-[#272F31]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Permit Expiry</label>
                <input
                  type="date"
                  required
                  value={permitExpiry}
                  onChange={(e) => setPermitExpiry(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-[#272F31]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Driver Name</label>
                <input
                  type="text"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  placeholder="e.g. Khaled Mansour"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#272F31]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingVehicle}
              className="w-full min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors disabled:opacity-50"
            >
              {savingVehicle ? 'Registering Vehicle...' : 'Add Certified 3PL Vehicle'}
            </button>
          </form>
        </div>
      )}

      {/* Modal 1: Accept Dispatch & Assign External 3PL Vehicle */}
      {acceptJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#272F31]/65 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-700">Stage 5 · 3PL Dispatch Acceptance</p>
                <h3 className="text-lg font-bold text-[#272F31]">Assign External Carrier Vehicle</h3>
              </div>
              <button
                type="button"
                onClick={() => setAcceptJob(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Confirm pickup acceptance for <span className="font-mono font-bold">{acceptJob.reservationCode}</span> (
              {acceptJob.quantityTons.toFixed(2)} t from {acceptJob.hub.nameEn}).
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Select Registered 3PL Vehicle</label>
              <select
                value={selectedVehicleId}
                onChange={(e) => setSelectedVehicleId(e.target.value ? Number(e.target.value) : '')}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 py-2 text-sm text-[#272F31] bg-white"
              >
                <option value="">— Assign later / default carrier truck —</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plateNumber} · {v.capacityTons}t · {v.envPermitNo}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={updatingId === acceptJob.id}
              onClick={() =>
                executeStatusUpdate(acceptJob, 'accepted', {
                  vehicleId: selectedVehicleId || undefined,
                })
              }
              className="w-full min-h-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm disabled:opacity-50"
            >
              {updatingId === acceptJob.id ? 'Confirming...' : 'Accept 3PL Dispatch'}
            </button>
          </div>
        </div>
      )}

      {/* Modal 2: On-Site QR & Handoff Weigh-in Verification (Stage 6) */}
      {handoffJob && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#272F31]/65 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-700">Stage 6 Chain of Custody</p>
                <h3 className="text-lg font-bold text-[#272F31]">Passport QR & Handoff Weigh-In</h3>
              </div>
              <button
                type="button"
                onClick={() => setHandoffJob(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {handoffError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {handoffError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Scanned / Confirmed Passport QR Code
                  </label>
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#272F31] hover:bg-[#333D40] px-2.5 py-1.5 text-xs font-semibold text-white transition-colors"
                  >
                    <ScanLine className="w-3.5 h-3.5 text-emerald-300" />
                    <span>{lang === 'ar' ? 'مسح QR بالكاميرا' : 'Scan QR Camera'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={qrInput}
                  onChange={(e) => {
                    const val = e.target.value;
                    const extracted = extractPassportCodeFromScan(val);
                    setQrInput(extracted || val);
                    setQrScannedVerified(false);
                  }}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 font-mono text-sm font-bold text-[#272F31]"
                />
                {qrScannedVerified ? (
                  <p className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5 mt-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>QR code scanned on-site and matched {handoffJob.passportCode}.</span>
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Expected lot: <span className="font-mono font-semibold">{handoffJob.passportCode}</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Handoff Weight at Pickup (kg)
                </label>
                <input
                  type="number"
                  min={50}
                  step={10}
                  value={handoffWeightKg}
                  onChange={(e) => setHandoffWeightKg(Number(e.target.value) || 0)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 py-2 font-mono text-base font-bold text-[#272F31]"
                />
                <p className="text-[11px] font-mono text-slate-500 mt-1">
                  Reserved manifest: {Math.round(handoffJob.quantityTons * 1000).toLocaleString()} kg (Delta recorded
                  automatically in Stage 6 audit log)
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Verification Method</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setHandoffMethod('ble_scale')}
                    className={`min-h-[42px] rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                      handoffMethod === 'ble_scale'
                        ? 'bg-[#272F31] text-white border-[#272F31]'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    <Scale className="w-3.5 h-3.5" />
                    <span>BLE Truck Scale</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setHandoffMethod('manifest_confirmed')}
                    className={`min-h-[42px] rounded-lg border text-xs font-semibold ${
                      handoffMethod === 'manifest_confirmed'
                        ? 'bg-[#272F31] text-white border-[#272F31]'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    Confirmed Manifest
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={updatingId === handoffJob.id}
              onClick={() =>
                executeStatusUpdate(handoffJob, 'picked_up', {
                  qrPassportCode: extractPassportCodeFromScan(qrInput) || qrInput.trim(),
                  handoffWeightKg,
                  handoffVerificationMethod: handoffMethod,
                })
              }
              className="w-full min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors disabled:opacity-50"
            >
              {updatingId === handoffJob.id ? 'Verifying...' : 'Confirm Pickup & Deduct Hub Stock'}
            </button>
          </div>
        </div>
      )}

      {/* Modal 3: Stage 6 Factory Delivery Confirmation & Proof of Delivery (POD) Upload */}
      {podJob && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#272F31]/65 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-amber-700">Stage 6 · Physical Drop-Off (DELIVERED)</p>
                <h3 className="text-lg font-bold text-[#272F31]">Confirm Delivery & Proof of Delivery</h3>
              </div>
              <button
                type="button"
                onClick={() => setPodJob(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
              <p className="font-bold">Strict Lifecycle Separation Notice:</p>
              <p>
                Confirming delivery transitions Passport <span className="font-mono font-bold">{podJob.passportCode}</span>{' '}
                to <strong>DELIVERED (Stage 6)</strong>. It will NOT be reported as <strong>RECYCLED</strong> or claim
                verified CO2e until {podJob.factory.nameEn} verifies recycling output in Stage 7.
              </p>
            </div>

            {podError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{podError}</div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Signed Proof of Delivery (POD) Photo or PDF (Optional)
              </label>
              <label className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 p-4 cursor-pointer text-xs font-semibold text-slate-700">
                {uploadingPod ? (
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                ) : (
                  <Upload className="w-4 h-4 text-emerald-600" />
                )}
                <span>{podFileName ? `Uploaded: ${podFileName}` : 'Upload Signed POD Slip (PDF / JPG / PNG)'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={handlePodUpload}
                  className="hidden"
                />
              </label>
            </div>

            <button
              type="button"
              disabled={updatingId === podJob.id || uploadingPod}
              onClick={() =>
                executeStatusUpdate(podJob, 'delivered', {
                  podFileId: podFileId || undefined,
                  podFileName: podFileName || undefined,
                })
              }
              className="w-full min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors disabled:opacity-50"
            >
              {updatingId === podJob.id ? 'Confirming Delivery...' : 'Confirm Factory Delivery (Stage 6)'}
            </button>
          </div>
        </div>
      )}

      {/* Live On-Site Camera / Image QR Scanner for Stage 6 Handoff */}
      <PassportQRScanner
        open={scannerOpen && Boolean(handoffJob)}
        lang={lang}
        expectedPassportCode={handoffJob?.passportCode}
        onDetected={(code) => {
          setQrInput(code);
          setQrScannedVerified(true);
          setHandoffError(null);
          setScannerOpen(false);
        }}
        onClose={() => setScannerOpen(false)}
      />

      {/* Operational Dispute Modal */}
      <DisputeModal
        open={Boolean(disputeTarget)}
        lang={lang}
        reservationId={disputeTarget?.reservationId}
        passportId={disputeTarget?.passportId}
        referenceLabel={disputeTarget?.label}
        onClose={() => setDisputeTarget(null)}
        onSubmitted={() => setToast('Operational dispute logged for OURO Platform Admin review.')}
      />
    </div>
  );
};

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
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { buildPassportQrUrl, extractPassportCodeFromScan } from '../lib/passport-qr.ts';
import { PassportQRScanner } from './PassportQRScanner.tsx';
import { DriverRouteMap, type RouteStop } from './maps/DriverRouteMap.tsx';
import {
  PICKUP_STATUS_FLOW,
  PICKUP_STATUS_LABELS,
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
  const [provider, setProvider] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // Handoff QR + Weight Verification Modal (for transitioning to 'picked_up')
  const [handoffJob, setHandoffJob] = useState<any>(null);
  const [qrInput, setQrInput] = useState('');
  const [qrScannedVerified, setQrScannedVerified] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [handoffWeightKg, setHandoffWeightKg] = useState<number>(0);
  const [handoffMethod, setHandoffMethod] = useState<'ble_scale' | 'manifest_confirmed'>(
    'manifest_confirmed'
  );
  const [handoffError, setHandoffError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/driver/jobs');
      setProvider(data.provider || null);
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
    () => jobs.filter((j) => j.pickupStatus !== 'delivered'),
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
    // Append destination recycling factory of primary stop
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
    try {
      await apiFetch(`/api/reservations/${job.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          nextStatus,
          gpsLat: job.hub.lat,
          gpsLng: job.hub.lng,
          ...extra,
        }),
      });
      setToast(
        nextStatus === 'delivered'
          ? `Delivery confirmed at ${job.factory.nameEn}. Passport ${job.passportCode} permanently sealed at Stage 7 (ESG Verified).`
          : `Stop ${job.reservationCode} updated to "${PICKUP_STATUS_LABELS[nextStatus][lang]}".`
      );
      setHandoffJob(null);
      await loadJobs();
    } catch (err: any) {
      if (handoffJob) {
        setHandoffError(err.message || 'Handoff verification failed.');
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
    executeStatusUpdate(job, next);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* 3PL Certified Carrier Header */}
      <div className="rounded-2xl bg-[#272F31] text-white p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-300 font-semibold">
            <Truck className="w-4 h-4" />
            <span>Certified Asset-Light 3PL Partner</span>
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
              {lang === 'ar' ? provider.nameAr : provider.nameEn} · Fleet: {provider.fleetCount}{' '}
              vehicles · On-Time Score:{' '}
              <span className="font-mono text-emerald-300 font-semibold">
                {provider.onTimeRate}%
              </span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <div>
            <span className="block text-slate-400">Active Stops</span>
            <span className="text-xl font-bold text-emerald-400 tabular-nums">
              {activeJobs.length}
            </span>
          </div>
          <div className="h-8 w-px bg-white/15" />
          <div>
            <span className="block text-slate-400">Completed</span>
            <span className="text-xl font-bold text-white tabular-nums">
              {completedJobs.length}
            </span>
          </div>
        </div>
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
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Responsive Split: Live Route Optimizer + Mobile-First Stop Execution Cards */}
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
              All assigned 3PL pickups have been delivered and sealed. New factory reservations will
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
                      <div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-600 text-white font-mono font-bold text-[11px]">
                            {idx + 1}
                          </span>
                          <span className="font-mono font-bold text-[#272F31]">
                            {job.passportCode}
                          </span>
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
                        <span className="block text-slate-500 mt-0.5">
                          {job.factory.industrialZone}
                        </span>
                      </div>
                    </div>

                    {/* 5-Step Progress Indicator */}
                    <div className="grid grid-cols-5 gap-1 pt-1">
                      {PICKUP_STATUS_FLOW.map((st, sIdx) => (
                        <div key={st} className="space-y-1">
                          <div
                            className={`h-1.5 rounded-full ${
                              sIdx <= curStepIdx ? 'bg-emerald-600' : 'bg-slate-200'
                            }`}
                          />
                          <span className="block text-[10px] text-slate-500 truncate">
                            {PICKUP_STATUS_LABELS[st][lang]}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Large Touch-Friendly Primary Action (>= 48px) */}
                    {nextStatus && (
                      <button
                        type="button"
                        disabled={updatingId === job.id}
                        onClick={() => handleAdvanceClick(job)}
                        className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors disabled:opacity-50"
                      >
                        {updatingId === job.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <span>
                              {nextStatus === 'picked_up'
                                ? t.driver.verifyQr
                                : nextStatus === 'delivered'
                                ? 'Confirm Factory Delivery & Seal Stage 7 ESG'
                                : `Mark as ${PICKUP_STATUS_LABELS[nextStatus][lang]}`}
                            </span>
                            <ArrowRight className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {/* Completed Stage-7 Deliveries List */}
          {completedJobs.length > 0 && (
            <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
              <h3 className="text-sm font-bold text-[#272F31] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>{t.driver.completedStops}</span>
              </h3>
              <div className="divide-y divide-slate-100">
                {completedJobs.slice(0, 6).map((c) => (
                  <div
                    key={c.id}
                    className="py-2.5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onInspectPassport(c.passportCode)}
                        className="font-mono font-bold text-emerald-700 hover:underline"
                      >
                        {c.passportCode}
                      </button>
                      <p className="text-slate-600 truncate">
                        {c.hub.nameEn} → {c.factory.nameEn}
                      </p>
                    </div>
                    <div className="text-right font-mono tabular-nums shrink-0">
                      <span className="font-bold text-[#272F31]">{c.quantityTons.toFixed(1)} t</span>
                      <span className="block text-[11px] text-emerald-700 font-semibold">
                        +{c.co2eAvoidedTons.toFixed(2)} tCO2e
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* On-Site QR & Handoff Weigh-in Verification Modal (Stage 6) */}
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
                <h3 className="text-lg font-bold text-[#272F31]">
                  Passport QR & Handoff Weigh-In
                </h3>
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
                  Reserved manifest: {Math.round(handoffJob.quantityTons * 1000).toLocaleString()} kg
                  (Delta check recorded automatically in Stage 6 audit log)
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Verification Method
                </label>
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
    </div>
  );
};

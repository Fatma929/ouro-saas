import React, { useEffect, useState } from 'react';
import {
  X,
  CheckCircle2,
  MapPin,
  Truck,
  Leaf,
  Clock,
  ShieldCheck,
  Loader2,
  Package,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { PassportQRCode } from './PassportQRCode.tsx';
import {
  MATERIAL_METADATA,
  PASSPORT_STAGES,
  HUB_TYPE_LABELS,
  type MaterialCategory,
  type HubType,
} from '../shared/constants.ts';
import { TRANSLATIONS, type Lang } from '../shared/i18n.ts';

interface PassportModalProps {
  passportCodeOrId: string | number | null;
  lang: Lang;
  onClose: () => void;
}

export const PassportModal: React.FC<PassportModalProps> = ({
  passportCodeOrId,
  lang,
  onClose,
}) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  const t = TRANSLATIONS[lang];

  useEffect(() => {
    if (!passportCodeOrId) return;
    let active = true;
    setLoading(true);
    setError(null);
    setImgError(false);

    apiFetch(`/api/passports/${encodeURIComponent(String(passportCodeOrId))}`)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Could not load Digital Waste Passport.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [passportCodeOrId]);

  if (!passportCodeOrId) return null;

  const passport = data?.passport;
  const hub = data?.hub;
  const events: any[] = data?.events || [];
  const resList: any[] = data?.reservations || [];
  const matMeta = passport
    ? MATERIAL_METADATA[passport.materialCategory as MaterialCategory]
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#272F31]/65 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white text-[#272F31] shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-[#272F31] text-white px-6 py-4">
          <div>
            <p className="text-xs font-medium text-emerald-300">{t.passport.title}</p>
            <h2 className="text-lg font-bold font-mono tracking-tight">
              {passport ? passport.passportCode : String(passportCodeOrId)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
            aria-label={t.passport.close}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
              <span className="text-sm font-medium">Loading 7-stage chain of custody...</span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && passport && (
            <>
              {/* Top Summary + QR + Photo */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                <div className="md:col-span-5 space-y-4">
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 aspect-[4/3]">
                    {passport.photoUrl && !imgError ? (
                      <img
                        src={passport.photoUrl}
                        alt={`${passport.materialSubtype} lot photo`}
                        referrerPolicy="no-referrer"
                        onError={() => setImgError(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-emerald-50 text-slate-500 p-4 text-center">
                        <Package className="w-8 h-8 text-emerald-600 mb-2" />
                        <span className="text-xs font-semibold">{passport.materialSubtype}</span>
                      </div>
                    )}
                  </div>

                  {/* Scannable QR Code & Bale Tag Export Card */}
                  <PassportQRCode
                    lang={lang}
                    size={128}
                    meta={{
                      passportCode: passport.passportCode,
                      materialSubtype: passport.materialSubtype,
                      purityGrade: passport.purityGrade,
                      weightKg: passport.initialWeightKg,
                      availableTons: passport.availableTons,
                      hubName: hub ? (lang === 'ar' ? hub.nameAr : hub.nameEn) : undefined,
                      hubCode: hub?.code,
                      verificationMethod: passport.verificationMethod,
                      currentStage: passport.currentStage,
                      createdAt: passport.createdAt,
                    }}
                  />
                </div>

                {/* Key Lot Specs */}
                <div className="md:col-span-7 space-y-4">
                  <div>
                    <div className="text-xs font-medium text-slate-500 flex flex-wrap items-center gap-1.5">
                      <span>{matMeta ? (lang === 'ar' ? matMeta.ar : matMeta.en) : passport.materialCategory}</span>
                      <span aria-hidden="true">·</span>
                      <span>{passport.purityGrade}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Stage {passport.currentStage} of 7
                      </span>
                    </div>
                    <h3 className="text-2xl font-bold text-[#272F31] mt-1">
                      {passport.materialSubtype}
                    </h3>
                    {hub && (
                      <p className="text-sm text-slate-600 mt-1 flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>
                          {lang === 'ar' ? hub.nameAr : hub.nameEn} ({hub.code}) ·{' '}
                          {HUB_TYPE_LABELS[hub.hubType as HubType]?.[lang] || hub.hubType} ·{' '}
                          {hub.governorate}
                        </span>
                      </p>
                    )}
                  </div>

                  {/* Quantitative Specs Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <p className="text-xs text-slate-500">Initial Weight</p>
                      <p className="text-base font-bold font-mono tabular-nums text-[#272F31]">
                        {(passport.initialWeightKg / 1000).toFixed(2)} t
                      </p>
                      <p className="text-[11px] font-mono text-slate-500">
                        {passport.initialWeightKg.toLocaleString()} kg
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Available / Reserved</p>
                      <p className="text-base font-bold font-mono tabular-nums text-emerald-700">
                        {passport.availableTons.toFixed(2)} / {passport.reservedTons.toFixed(2)} t
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Rate (EGP / ton)</p>
                      <p className="text-base font-bold font-mono tabular-nums text-[#272F31]">
                        {passport.pricePerTonEgp.toLocaleString()} EGP
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">CO2e Factor / Sealed</p>
                      <p className="text-base font-bold font-mono tabular-nums text-emerald-700">
                        {passport.verifiedCo2eTons > 0
                          ? `${passport.verifiedCo2eTons.toFixed(2)} tCO2e`
                          : `${passport.co2eFactorPerTon} /t`}
                      </p>
                    </div>
                  </div>

                  {/* Active / Past 3PL Reservations */}
                  {resList.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-[#F8FAFC] p-4 space-y-2">
                      <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Linked Factory Reservations & Certified 3PL Custody</span>
                      </p>
                      {resList.map((r) => (
                        <div
                          key={r.id}
                          className="flex flex-wrap items-center justify-between gap-2 text-xs pt-2 border-t border-slate-200 first:border-t-0 first:pt-0"
                        >
                          <div>
                            <span className="font-mono font-semibold text-[#272F31]">
                              {r.reservationCode}
                            </span>
                            <span className="text-slate-500 mx-1.5">·</span>
                            <span className="font-medium text-slate-800">{r.factoryNameEn}</span>
                            <div className="text-slate-500 mt-0.5">
                              3PL: {r.logisticsProviderNameEn} · License{' '}
                              <span className="font-mono text-[#272F31]">{r.logisticsProviderLicense}</span>
                            </div>
                          </div>
                          <div className="text-right font-mono tabular-nums">
                            <span className="font-semibold text-[#272F31]">{r.quantityTons} t</span>
                            <span className="text-slate-500 mx-1">·</span>
                            <span className="font-semibold text-emerald-700 capitalize">
                              {String(r.pickupStatus).replace('_', ' ')}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 7-Stage Chain of Custody Progress */}
              <div className="pt-4 border-t border-slate-200">
                <h4 className="text-sm font-bold text-[#272F31] mb-3">{t.passport.chainOfCustody}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
                  {PASSPORT_STAGES.map((st) => {
                    const reached = passport.currentStage >= st.stage;
                    const isCurrent = passport.currentStage === st.stage;
                    return (
                      <div
                        key={st.stage}
                        className={`rounded-lg border p-2.5 transition-colors ${
                          reached
                            ? isCurrent
                              ? 'border-emerald-600 bg-emerald-50 text-[#272F31]'
                              : 'border-emerald-200 bg-emerald-50/50 text-[#272F31]'
                            : 'border-slate-200 bg-slate-50 text-slate-400'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-mono font-bold mb-1">
                          <span>0{st.stage}</span>
                          {reached && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                        </div>
                        <p className="text-[11px] font-semibold leading-snug">
                          {lang === 'ar' ? st.ar : st.en}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Immutable Append-Only Event Audit Trail */}
              <div className="pt-4 border-t border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-[#272F31] flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>{t.passport.auditTrail}</span>
                  </h4>
                  <span className="text-xs font-mono text-slate-500">
                    {events.length} append-only records
                  </span>
                </div>
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                  {events.map((ev) => (
                    <div key={ev.id} className="p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-emerald-700">
                            Stage {ev.stage}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="font-semibold text-[#272F31]">{ev.actorName}</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-500">{ev.eventType.replace(/_/g, ' ')}</span>
                        </div>
                        <p className="text-sm text-slate-700">
                          {lang === 'ar' ? ev.summaryAr : ev.summaryEn}
                        </p>
                        {ev.lat && ev.lng && (
                          <p className="text-[11px] font-mono text-slate-400">
                            GPS: {Number(ev.lat).toFixed(4)}, {Number(ev.lng).toFixed(4)}
                          </p>
                        )}
                      </div>
                      <div className="text-xs font-mono text-slate-500 whitespace-nowrap flex items-center gap-1 shrink-0">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(ev.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ESG Factor Footer Note */}
              {matMeta && (
                <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-600">
                  <Leaf className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-[#272F31]">ESG Methodology Reference: </span>
                    {matMeta.methodologyRef} — Emission Factor:{' '}
                    <span className="font-mono font-semibold text-[#272F31]">
                      {matMeta.co2eFactorPerTon} tCO2e / metric ton
                    </span>
                    .
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { X, Printer, Download, ShieldCheck, Loader2, AlertTriangle } from 'lucide-react';
import { apiFetch, downloadAuthenticatedCsv } from '../lib/api.ts';
import { OuroLogo } from './OuroLogo.tsx';

interface EsgCertificateModalProps {
  open: boolean;
  onClose: () => void;
}

export const EsgCertificateModal: React.FC<EsgCertificateModalProps> = ({ open, onClose }) => {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    apiFetch('/api/esg/report')
      .then((res) => {
        if (active) setReport(res);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Failed to load ESG impact report');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  if (!open) return null;

  const handleDownloadCsv = async () => {
    setDownloading(true);
    try {
      await downloadAuthenticatedCsv(
        '/api/esg/export.csv',
        `OURO_ESG_Verified_Recycled_Ledger_${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch (err: any) {
      setError(err.message || 'CSV download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#272F31]/70 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white text-[#272F31] shadow-2xl border border-slate-200">
        {/* Action Bar (hidden when printing) */}
        <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-[#272F31] px-6 py-4 text-white">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span className="font-bold text-sm">Auditable ESG Environmental Impact Certificate</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={downloading || !report}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{downloading ? 'Exporting...' : 'Download Verified CSV'}</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!report}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / Save PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] rounded-lg bg-white/10 hover:bg-white/20 text-white"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Certificate Body */}
        <div className="p-8 space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
              <span className="text-sm font-medium">Compiling verified Stage-7 Recycling Ledger...</span>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && report && (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-6 border-b-2 border-[#272F31]">
                <div>
                  <OuroLogo variant="dark" size="lg" showTagline />
                  <h1 className="text-2xl font-extrabold text-[#272F31] mt-4">
                    Verified Circular Economy ESG Impact Statement
                  </h1>
                  <p className="text-xs text-slate-600 mt-1">
                    Strictly Stage-7 Verified Recycled Outcomes · Transport-Adjusted Net GHG Accounting
                  </p>
                </div>
                <div className="text-left sm:text-right font-mono text-xs space-y-1">
                  <p className="font-bold text-[#272F31]">{report.certificateId}</p>
                  <p className="text-slate-500">
                    Issued: {new Date(report.generatedAt).toLocaleString()}
                  </p>
                  <p className="text-emerald-700 font-semibold">Audit-Ready Verified Ledger</p>
                </div>
              </div>

              {/* Headline Totals — Strictly Verified vs Pending */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                  <p className="text-xs font-medium text-emerald-800">Verified Recycled Output</p>
                  <p className="text-2xl font-extrabold font-mono tabular-nums text-emerald-900 mt-1">
                    {Number(report.totalVerifiedRecycledTons ?? report.totalVerifiedTons).toFixed(2)} t
                  </p>
                  <p className="text-[11px] text-emerald-700 mt-0.5">
                    Residual/Loss: {Number(report.totalResidualAndLossTons || 0).toFixed(2)} t
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                  <p className="text-xs font-medium text-emerald-800">Net Verified CO2e Avoided</p>
                  <p className="text-2xl font-extrabold font-mono tabular-nums text-emerald-800 mt-1">
                    {Number(report.totalCo2eAvoidedTons).toFixed(2)} tCO2e
                  </p>
                  <p className="text-[11px] text-emerald-700 mt-0.5">
                    After −{Number(report.totalTransportEmissionsTons || 0).toFixed(3)} t freight
                  </p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                  <p className="text-xs font-medium text-amber-800">Delivered (Pending Recycling)</p>
                  <p className="text-2xl font-extrabold font-mono tabular-nums text-amber-900 mt-1">
                    {Number(report.totalDeliveredPendingTons || 0).toFixed(2)} t
                  </p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    Excluded from verified CO2e totals
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-[#F6F7F7] p-4">
                  <p className="text-xs font-medium text-slate-500">Stage-7 Verified Lots</p>
                  <p className="text-2xl font-extrabold font-mono tabular-nums text-[#272F31] mt-1">
                    {report.items.length} lots
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {report.deliveredPendingItems?.length || 0} delivered awaiting proof
                  </p>
                </div>
              </div>

              {/* Itemized Verified Stage-7 Recycled Passports */}
              <div>
                <h2 className="text-sm font-bold text-[#272F31] mb-2">
                  Itemized Verified Recycled Outcomes (Stage 7 — Included in ESG Claims)
                </h2>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <th className="py-2.5 px-3 font-semibold">Passport</th>
                        <th className="py-2.5 px-3 font-semibold">Generator & Recycler</th>
                        <th className="py-2.5 px-3 font-semibold">Material</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Recovered / Deliv.</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Freight CO2e</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Net CO2e</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Confidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.items.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            No Stage-7 verified recycling outcomes recorded yet. Delivered shipments must be verified by the recycling facility before entering this ledger.
                          </td>
                        </tr>
                      ) : (
                        report.items.map((item: any) => (
                          <tr key={item.reservationCode} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-3 font-mono font-semibold text-[#272F31]">
                              <div>{item.passportCode}</div>
                              {item.isSampleData && (
                                <span className="text-[10px] text-amber-700 font-normal">Pilot sample</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-[#272F31]">{item.hubNameEn}</div>
                              <div className="text-[11px] text-slate-500">
                                → {item.factoryNameEn} (Tax: {item.factoryTaxId})
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div>{item.materialLabel}</div>
                              <div className="text-[11px] text-slate-500">
                                {item.purityGrade} · {item.co2eFactorPerTon.toFixed(2)} t/t
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              <div className="font-bold text-emerald-800">{item.recoveredTons.toFixed(2)} t</div>
                              <div className="text-[10px] text-slate-500">of {item.deliveredTons.toFixed(2)} t</div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                              −{Number(item.transportEmissionsTons || 0).toFixed(3)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-700">
                              {item.co2eAvoidedTons.toFixed(2)} t
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <span className="inline-block rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                                {item.esgConfidenceLevel}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Separate Table for Delivered-Only (Pending Recycling Verification) */}
              {report.deliveredPendingItems && report.deliveredPendingItems.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>
                      Delivered Shipments Pending Recycling Verification (NOT counted in Verified Recycled Totals)
                    </span>
                  </div>
                  <div className="divide-y divide-amber-200/60 text-xs">
                    {report.deliveredPendingItems.map((item: any) => (
                      <div key={item.reservationCode} className="py-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-mono font-bold text-[#272F31]">{item.passportCode}</span>
                          <span className="text-slate-500 mx-1.5">·</span>
                          <span>{item.hubNameEn} → {item.factoryNameEn}</span>
                        </div>
                        <div className="font-mono tabular-nums text-amber-900">
                          {item.deliveredTons.toFixed(2)} t delivered ·{' '}
                          {item.recyclingStatus === 'submitted_for_verification'
                            ? 'Submitted (Awaiting Verifier Approval)'
                            : 'Pending Recycling Proof'}{' '}
                          · Est. ~{Number(item.estimatedCo2eTons || 0).toFixed(2)} tCO2e (unverified)
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Explicit Methodology, Geographic Boundaries & Limitations Disclosures */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div>
                  <h3 className="text-xs font-bold text-[#272F31]">
                    Methodology, System Boundaries &amp; Scientific Limitation Disclosures
                  </h3>
                  {report.methodologyDisclosure && (
                    <div className="mt-1.5 space-y-1.5 text-[11px] text-slate-600">
                      <p>
                        <strong>Accounting Rule:</strong> {report.methodologyDisclosure.accountingPrinciple}
                      </p>
                      <p className="font-mono text-[11px] text-[#272F31]">
                        {report.methodologyDisclosure.formula}
                      </p>
                      {report.methodologyDisclosure.limitations && (
                        <div className="pt-1 space-y-1 text-[11px] text-slate-600 border-t border-slate-200">
                          <p>
                            <strong>Geographic &amp; Grid Proxy Limitation:</strong>{' '}
                            {report.methodologyDisclosure.limitations.geographicScope}
                          </p>
                          <p>
                            <strong>Transport Distance Basis:</strong>{' '}
                            {report.methodologyDisclosure.limitations.transportAssumption}
                          </p>
                          <p>
                            <strong>Independent Verification Requirement:</strong>{' '}
                            {report.methodologyDisclosure.limitations.verifierRequirement}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-600">
                  {report.emissionFactors.map((ef: any) => (
                    <div key={ef.category} className="rounded-lg border border-slate-200 bg-white p-3 space-y-1">
                      <div className="flex justify-between gap-2">
                        <span className="font-bold text-[#272F31]">{ef.label}</span>
                        <span className="font-mono font-bold text-emerald-700 whitespace-nowrap">
                          {ef.factor.toFixed(2)} tCO2e/t
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500">{ef.methodologyRef}</p>
                      {ef.boundaryNotes && <p className="text-[11px] text-slate-500">{ef.boundaryNotes}</p>}
                      {ef.baselineScenario && (
                        <p className="text-[10px] text-slate-400">Baseline: {ef.baselineScenario}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

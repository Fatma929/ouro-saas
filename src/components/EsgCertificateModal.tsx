import React, { useEffect, useState } from 'react';
import { X, Printer, Download, ShieldCheck, Loader2 } from 'lucide-react';
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
        `OURO_ESG_Verified_Ledger_${new Date().toISOString().slice(0, 10)}.csv`
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
      <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white text-[#272F31] shadow-2xl border border-slate-200">
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
              <span>{downloading ? 'Exporting...' : 'Download CSV Ledger'}</span>
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
              <span className="text-sm font-medium">Compiling verified Stage-7 Passports...</span>
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
                    Verified Circular Economy ESG Certificate
                  </h1>
                  <p className="text-xs text-slate-600 mt-1">
                    Chain-of-Custody Verified Stage 7 Digital Waste Passports · Egypt & MENA Operations
                  </p>
                </div>
                <div className="text-left sm:text-right font-mono text-xs space-y-1">
                  <p className="font-bold text-[#272F31]">{report.certificateId}</p>
                  <p className="text-slate-500">
                    Issued: {new Date(report.generatedAt).toLocaleString()}
                  </p>
                  <p className="text-emerald-700 font-semibold">Status: Audit-Ready Ledger</p>
                </div>
              </div>

              {/* Headline Totals */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-slate-200 bg-[#F6F7F7] p-4">
                  <p className="text-xs font-medium text-slate-500">Verified Diverted Material</p>
                  <p className="text-2xl font-extrabold font-mono tabular-nums text-[#272F31] mt-1">
                    {report.totalVerifiedTons.toFixed(2)} metric tons
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                  <p className="text-xs font-medium text-emerald-800">Avoided GHG Emissions</p>
                  <p className="text-2xl font-extrabold font-mono tabular-nums text-emerald-700 mt-1">
                    {report.totalCo2eAvoidedTons.toFixed(2)} tCO2e
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-[#F6F7F7] p-4">
                  <p className="text-xs font-medium text-slate-500">Sealed Stage-7 Passports</p>
                  <p className="text-2xl font-extrabold font-mono tabular-nums text-[#272F31] mt-1">
                    {report.items.length} lots
                  </p>
                </div>
              </div>

              {/* Itemized Passport Table */}
              <div>
                <h2 className="text-sm font-bold text-[#272F31] mb-2">
                  Itemized Verified Digital Waste Passports
                </h2>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <th className="py-2.5 px-3 font-semibold">Passport ID</th>
                        <th className="py-2.5 px-3 font-semibold">Waste Generator</th>
                        <th className="py-2.5 px-3 font-semibold">Recycling Factory</th>
                        <th className="py-2.5 px-3 font-semibold">3PL License</th>
                        <th className="py-2.5 px-3 font-semibold">Material</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Net Tons</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Factor</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Avoided tCO2e</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.items.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-500">
                            No sealed Stage-7 deliveries recorded yet. Complete a 3PL delivery to seal a Passport.
                          </td>
                        </tr>
                      ) : (
                        report.items.map((item: any) => (
                          <tr key={item.reservationCode} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-3 font-mono font-semibold text-[#272F31]">
                              {item.passportCode}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-[#272F31]">{item.hubNameEn}</div>
                              <div className="text-[11px] text-slate-500">{item.hubGovernorate}</div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-[#272F31]">{item.factoryNameEn}</div>
                              <div className="text-[11px] font-mono text-slate-500">Tax: {item.factoryTaxId}</div>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">
                              {item.logisticsLicenseId}
                            </td>
                            <td className="py-2.5 px-3">
                              <div>{item.materialLabel}</div>
                              <div className="text-[11px] text-slate-500">{item.purityGrade}</div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                              {item.verifiedTons.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                              {item.co2eFactorPerTon.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-700">
                              {item.co2eAvoidedTons.toFixed(2)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Explicit Methodology Disclosure */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <h3 className="text-xs font-bold text-[#272F31]">
                  Documented Emission Factors & Accounting Methodology (EPA WARM v16 / IPCC 2006)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600">
                  {report.emissionFactors.map((ef: any) => (
                    <div key={ef.category} className="flex justify-between gap-2 border-b border-slate-200/70 pb-1">
                      <div>
                        <span className="font-semibold text-[#272F31]">{ef.label}</span>
                        <span className="block text-[11px] text-slate-500">{ef.methodologyRef}</span>
                      </div>
                      <span className="font-mono font-bold text-emerald-700 whitespace-nowrap">
                        {ef.factor.toFixed(2)} tCO2e/t
                      </span>
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

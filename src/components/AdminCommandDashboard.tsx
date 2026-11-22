import React, { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Plus,
  Truck,
  Download,
  Printer,
  FileText,
  QrCode,
  Loader2,
  X,
  ShieldCheck,
  LayoutGrid,
  Table as TableIcon,
  Users,
  Activity,
  Scale,
  Flag,
  Info,
} from 'lucide-react';
import { apiFetch, downloadAuthenticatedCsv, downloadSignedPrivateFile } from '../lib/api.ts';
import { PlacesAutocompleteInput } from './maps/GoogleMapsProvider.tsx';
import {
  GOVERNORATES,
  FACILITY_TYPE_LABELS,
  ROLE_LABELS,
  type FacilityType,
  type UserRole,
} from '../shared/constants.ts';
import { TRANSLATIONS, type Lang } from '../shared/i18n.ts';

interface AdminCommandDashboardProps {
  lang: Lang;
  onInspectPassport: (code: string) => void;
  onOpenEsgCertificate: () => void;
}

export const AdminCommandDashboard: React.FC<AdminCommandDashboardProps> = ({
  lang,
  onInspectPassport,
  onOpenEsgCertificate,
}) => {
  const t = TRANSLATIONS[lang];
  const [tab, setTab] = useState<'analytics' | 'kyc' | 'hubs' | 'disputes' | 'governance' | 'audit'>('analytics');
  const [data, setData] = useState<any>(null);
  const [systemHealth, setSystemHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // KYC & 3PL Verification state
  const [reviewReasons, setReviewReasons] = useState<Record<number, string>>({});
  const [kycBusyId, setKycBusyId] = useState<number | null>(null);
  const [providerReasons, setProviderReasons] = useState<Record<number, string>>({});
  const [providerBusyId, setProviderBusyId] = useState<number | null>(null);

  // Disputes state
  const [disputeNotes, setDisputeNotes] = useState<Record<number, string>>({});
  const [disputeStatuses, setDisputeStatuses] = useState<Record<number, string>>({});
  const [disputeBusyId, setDisputeBusyId] = useState<number | null>(null);

  // Users & Emission Factors state
  const [userBusyId, setUserBusyId] = useState<number | null>(null);
  const [factorDrafts, setFactorDrafts] = useState<
    Record<string, { co2eFactorPerTon: number; transportFactorKgPerTonKm: number; version: string; reason: string }>
  >({});
  const [factorBusyCat, setFactorBusyCat] = useState<string | null>(null);

  // Waste Generators Directory view mode
  const [generatorView, setGeneratorView] = useState<'table' | 'grid'>('table');
  const [dispatchBusyId, setDispatchBusyId] = useState<number | null>(null);

  // Register New Waste Generator Modal
  const [showNewHubModal, setShowNewHubModal] = useState(false);
  const [newHubNameEn, setNewHubNameEn] = useState('');
  const [newHubNameAr, setNewHubNameAr] = useState('');
  const [newHubType, setNewHubType] = useState<FacilityType>('factory');
  const [newHubCrNo, setNewHubCrNo] = useState('');
  const [newHubGov, setNewHubGov] = useState<string>('Greater Cairo');
  const [newHubAddress, setNewHubAddress] = useState('');
  const [newHubLat, setNewHubLat] = useState<number>(30.0444);
  const [newHubLng, setNewHubLng] = useState<number>(31.2357);
  const [newHubCapacity, setNewHubCapacity] = useState<number>(30);
  const [creatingHub, setCreatingHub] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, healthRes] = await Promise.all([
        apiFetch('/api/admin/overview'),
        apiFetch('/api/admin/system-health').catch(() => null),
      ]);
      setData(overviewRes);
      if (healthRes) setSystemHealth(healthRes);

      if (overviewRes?.emissionFactors) {
        const drafts: Record<
          string,
          { co2eFactorPerTon: number; transportFactorKgPerTonKm: number; version: string; reason: string }
        > = {};
        for (const ef of overviewRes.emissionFactors) {
          drafts[ef.materialCategory] = {
            co2eFactorPerTon: ef.co2eFactorPerTon,
            transportFactorKgPerTonKm: ef.transportFactorKgPerTonKm,
            version: ef.version,
            reason: '',
          };
        }
        setFactorDrafts(drafts);
      }
    } catch (err: any) {
      setError(err.message || 'Could not load Admin command overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const handleKycDecision = async (factoryId: number, decision: 'approved' | 'rejected') => {
    const reason = (reviewReasons[factoryId] || '').trim();
    if (reason.length < 5) {
      setError('Please enter a brief audit review reason (at least 5 characters) before deciding.');
      return;
    }
    setKycBusyId(factoryId);
    setError(null);
    try {
      await apiFetch(`/api/admin/factories/${factoryId}/kyc`, {
        method: 'PATCH',
        body: JSON.stringify({ decision, reason }),
      });
      setToast(`Factory KYC ${decision === 'approved' ? 'approved' : 'rejected'} and recorded in audit log.`);
      await loadOverview();
    } catch (err: any) {
      setError(err.message || 'KYC decision failed.');
    } finally {
      setKycBusyId(null);
    }
  };

  const handleProviderDecision = async (providerId: number, status: 'approved' | 'suspended') => {
    const reason = (providerReasons[providerId] || '').trim();
    if (reason.length < 5) {
      setError('Please enter an audit reason (at least 5 characters) before updating 3PL verification.');
      return;
    }
    setProviderBusyId(providerId);
    setError(null);
    try {
      await apiFetch(`/api/admin/providers/${providerId}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reason }),
      });
      setToast(`3PL partner verification updated to ${status.toUpperCase()} and audited.`);
      await loadOverview();
    } catch (err: any) {
      setError(err.message || '3PL verification update failed.');
    } finally {
      setProviderBusyId(null);
    }
  };

  const handleResolveDispute = async (disputeId: number, currentStatus: string) => {
    const nextStatus = disputeStatuses[disputeId] || (currentStatus === 'open' ? 'resolved' : currentStatus);
    const resolutionNote = (disputeNotes[disputeId] || '').trim();
    if ((nextStatus === 'resolved' || nextStatus === 'dismissed') && resolutionNote.length < 5) {
      setError('Please enter a resolution note (at least 5 characters) before closing a dispute.');
      return;
    }
    setDisputeBusyId(disputeId);
    setError(null);
    try {
      await apiFetch(`/api/admin/disputes/${disputeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus, resolutionNote }),
      });
      setToast(`Dispute updated to ${nextStatus.toUpperCase()} and reporter notified.`);
      await loadOverview();
    } catch (err: any) {
      setError(err.message || 'Failed to update dispute.');
    } finally {
      setDisputeBusyId(null);
    }
  };

  const handleToggleUserActive = async (userRow: any) => {
    setUserBusyId(userRow.id);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${userRow.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          isActive: !userRow.isActive,
          reason: `Admin toggled account status to ${!userRow.isActive ? 'active' : 'suspended'} via Governance Console.`,
        }),
      });
      setToast(`Account ${userRow.email} is now ${!userRow.isActive ? 'ACTIVE' : 'DEACTIVATED'}.`);
      await loadOverview();
    } catch (err: any) {
      setError(err.message || 'Could not update user account status.');
    } finally {
      setUserBusyId(null);
    }
  };

  const handleSaveEmissionFactor = async (category: string) => {
    const draft = factorDrafts[category];
    if (!draft) return;
    setFactorBusyCat(category);
    setError(null);
    try {
      await apiFetch(`/api/admin/emission-factors/${category}`, {
        method: 'PATCH',
        body: JSON.stringify({
          co2eFactorPerTon: draft.co2eFactorPerTon,
          transportFactorKgPerTonKm: draft.transportFactorKgPerTonKm,
          version: draft.version,
          reason: draft.reason || `Updated ${category} emission factor via Admin Governance Console.`,
        }),
      });
      setToast(`Emission factor for ${category} updated in PostgreSQL and logged.`);
      await loadOverview();
    } catch (err: any) {
      setError(err.message || 'Failed to update emission factor.');
    } finally {
      setFactorBusyCat(null);
    }
  };

  const handleAssign3pl = async (hubId: number, hubName: string) => {
    setDispatchBusyId(hubId);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/hubs/${hubId}/assign-pickup`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setToast(`Assigned ${res.provider.nameEn} (${res.provider.envTransportLicenseId}) to clear ${hubName}.`);
      await loadOverview();
    } catch (err: any) {
      setError(err.message || '3PL dispatch failed.');
    } finally {
      setDispatchBusyId(null);
    }
  };

  const handleCreateHub = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingHub(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/hubs', {
        method: 'POST',
        body: JSON.stringify({
          nameEn: newHubNameEn,
          nameAr: newHubNameAr || newHubNameEn,
          hubType: newHubType,
          commercialRegNo: newHubCrNo || undefined,
          governorate: newHubGov,
          address: newHubAddress,
          lat: newHubLat,
          lng: newHubLng,
          maxCapacityTons: newHubCapacity,
        }),
      });
      setToast(`Registered new Waste Generator Facility: ${res.hub.nameEn} (${res.hub.code}).`);
      setShowNewHubModal(false);
      setNewHubNameEn('');
      setNewHubNameAr('');
      setNewHubCrNo('');
      setNewHubAddress('');
      await loadOverview();
    } catch (err: any) {
      setError(err.message || 'Could not register waste generator facility.');
    } finally {
      setCreatingHub(false);
    }
  };

  const handleDownloadCsv = async () => {
    try {
      await downloadAuthenticatedCsv(
        '/api/esg/export.csv',
        `OURO_ESG_Verified_Ledger_${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch (err: any) {
      setError(err.message || 'CSV export failed.');
    }
  };

  const handleInspectKycDoc = async (fileId: number, fileName: string) => {
    setError(null);
    try {
      await downloadSignedPrivateFile(fileId, fileName);
    } catch (err: any) {
      setError(err.message || 'Failed to download signed KYC document.');
    }
  };

  if (loading && !data) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-20 flex items-center justify-center gap-2 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
        <span className="text-sm font-medium">Loading OURO Command Dashboard...</span>
      </div>
    );
  }

  const kpis = data?.kpis;
  const integrity = data?.dataIntegrityNotice;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header & Primary ESG Export Controls */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">Platform Governance · Egypt & MENA Operations</p>
          <h1 className="text-2xl font-extrabold text-[#272F31] mt-0.5">{t.admin.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-semibold text-[#272F31] min-h-[40px] whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span>{t.admin.exportCsv}</span>
          </button>
          <button
            type="button"
            onClick={onOpenEsgCertificate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#272F31] hover:bg-[#333D40] px-3.5 py-2 text-xs font-semibold text-white min-h-[40px] whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t.admin.printCertificate}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowNewHubModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white min-h-[40px] whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.admin.registerHub}</span>
          </button>
        </div>
      </div>

      {/* Pilot Sample Data Integrity Disclosure Banner */}
      {integrity?.hasSamplePilotRecords && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-xs text-amber-950 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold">
              Pilot Environment Data Disclosure: {integrity.samplePassportsCount} seeded pilot passport(s) and{' '}
              {integrity.livePassportsCount} live operational passport(s) in PostgreSQL.
            </p>
            <p className="text-amber-900">
              All analytics strictly separate <strong>LISTED</strong>, <strong>DELIVERED</strong>, and{' '}
              <strong>VERIFIED RECYCLED</strong> quantities directly from PostgreSQL—zero fabricated historical series.
            </p>
          </div>
        </div>
      )}

      {toast && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 flex items-center justify-between gap-2">
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
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 6-Metric Platform KPI Summary Row (Strict 3-Status Separation) */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
          <div className="rounded-xl bg-white border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Listed Volume</p>
            <p className="text-xl font-extrabold font-mono tabular-nums text-[#272F31] mt-1">
              {Number(kpis.listedTons ?? kpis.totalCollectedTons).toFixed(1)} t
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">{kpis.activeSourceHubs} active generators</p>
          </div>
          <div className="rounded-xl bg-white border border-amber-200 p-4">
            <p className="text-xs text-amber-800">Delivered (Stage 6)</p>
            <p className="text-xl font-extrabold font-mono tabular-nums text-amber-900 mt-1">
              {Number(kpis.deliveredTons ?? 0).toFixed(1)} t
            </p>
            <p className="text-[11px] text-amber-700 mt-0.5">Physical drop-off logged</p>
          </div>
          <div className="rounded-xl bg-white border border-emerald-200 p-4">
            <p className="text-xs text-emerald-800">Verified Recycled</p>
            <p className="text-xl font-extrabold font-mono tabular-nums text-emerald-700 mt-1">
              {Number(kpis.verifiedRecycledTons ?? 0).toFixed(1)} t
            </p>
            <p className="text-[11px] text-emerald-700 mt-0.5">Stage 7 evidence sealed</p>
          </div>
          <div className="rounded-xl bg-white border border-emerald-200 p-4">
            <p className="text-xs text-emerald-800">Verified Net CO2e</p>
            <p className="text-xl font-extrabold font-mono tabular-nums text-emerald-700 mt-1">
              {Number(kpis.verifiedCo2eTons ?? 0).toFixed(1)} t
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Est. unverified: {Number(kpis.estimatedCo2eTons ?? 0).toFixed(1)} t
            </p>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Approved Factories</p>
            <p className="text-xl font-extrabold font-mono tabular-nums text-[#272F31] mt-1">
              {kpis.approvedFactories}
            </p>
            <p className="text-[11px] text-amber-700 font-semibold mt-0.5">
              {kpis.pendingFactories} pending · {kpis.certified3plPartners} 3PLs
            </p>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Open Disputes</p>
            <p
              className={`text-xl font-extrabold font-mono tabular-nums mt-1 ${
                (kpis.openDisputesCount ?? 0) > 0 ? 'text-amber-700' : 'text-[#272F31]'
              }`}
            >
              {kpis.openDisputesCount ?? 0}
            </p>
            {kpis.highCapacityAlerts > 0 ? (
              <p className="text-[11px] font-semibold text-amber-700 mt-0.5">
                {kpis.highCapacityAlerts} facility &ge;80% cap
              </p>
            ) : (
              <p className="text-[11px] text-slate-500 mt-0.5">Capacity nominal</p>
            )}
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-200/70">
        {[
          { id: 'analytics', label: t.admin.overviewTab },
          { id: 'kyc', label: `KYC & 3PL Verification (${kpis?.pendingFactories ?? 0})` },
          { id: 'hubs', label: `${t.admin.hubsTab} (${data?.hubs?.length ?? 0})` },
          { id: 'disputes', label: `Disputes Desk (${kpis?.openDisputesCount ?? 0})` },
          { id: 'governance', label: 'Users, ESG Factors & Health' },
          { id: 'audit', label: 'Passport Feed & Audit Log' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id as any)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === item.id ? 'bg-white text-[#272F31] shadow-xs' : 'text-slate-600 hover:text-[#272F31]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* TAB 1: REAL DB-BACKED RECHARTS ANALYTICS */}
      {tab === 'analytics' && data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 1: Live Lifecycle Mass-Balance by Material (Listed vs Delivered vs Verified Recycled) */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-[#272F31]">
                Live Lifecycle Reconciliation by Material (tons)
              </h2>
              <p className="text-xs text-slate-500">
                Real PostgreSQL totals strictly separating Listed, Delivered (Stage 6), and Verified Recycled (Stage 7)
              </p>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.lifecycleBreakdownChart || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#475569' }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="listedTons" name="Listed (t)" fill="#272F31" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="deliveredTons" name="Delivered Stage 6 (t)" fill="#A88B64" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="recycledTons" name="Verified Recycled Stage 7 (t)" fill="#3D7568" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Verified Recycled Tons vs Verified Net Carbon Avoided */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-[#272F31]">Verified Recycling & Net GHG Impact</h2>
              <p className="text-xs text-slate-500">
                Stage 7 verified recovered output (tons) vs. transport-adjusted net avoided tCO2e
              </p>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.categoryFlow || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#475569' }}
                    interval={0}
                    tickFormatter={(v) => String(v).split(' ')[0]}
                  />
                  <YAxis tick={{ fontSize: 12, fill: '#475569' }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="recycledTons" name="Verified Recycled (t)" fill="#272F31" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="verifiedCo2e" name="Verified Net CO2e (t)" fill="#3D7568" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 3: Waste Generator Purity Scores */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-[#272F31]">Waste Generator Sorting Quality (%)</h2>
              <p className="text-xs text-slate-500">On-site sorting purity across registered B2B facilities</p>
            </div>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.hubPurityChart || []} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis type="number" domain={[80, 100]} tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis dataKey="name" type="category" width={96} tick={{ fontSize: 11, fill: '#272F31' }} />
                  <Tooltip />
                  <Bar dataKey="purityScore" name="Purity (%)" fill="#3D7568" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 4: 3PL Logistics On-Time Performance */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-[#272F31]">Certified 3PL On-Time Performance (%)</h2>
              <p className="text-xs text-slate-500">Asset-light external environmental transport carriers</p>
            </div>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.providerPerformanceChart || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis domain={[80, 100]} tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip />
                  <Bar dataKey="onTimeRate" name="On-Time (%)" fill="#A88B64" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: FACTORY KYC & EXTERNAL 3PL PROVIDER VERIFICATION */}
      {tab === 'kyc' && data && (
        <div className="space-y-6">
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-[#272F31]">Recycling Factory KYC Approval Queue</h2>
            {data.factories.map((fac: any) => (
              <div
                key={fac.id}
                className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`font-bold ${
                        fac.kycStatus === 'approved'
                          ? 'text-emerald-700'
                          : fac.kycStatus === 'rejected'
                          ? 'text-red-700'
                          : 'text-amber-700'
                      }`}
                    >
                      Status: {String(fac.kycStatus).toUpperCase()}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span>{fac.governorate}</span>
                    <span className="text-slate-400">·</span>
                    <span>{fac.industrialZone}</span>
                  </div>
                  <h3 className="text-base font-bold text-[#272F31]">{fac.nameEn}</h3>
                  <p className="text-xs text-slate-600 font-mono">
                    Tax ID: <strong>{fac.taxId}</strong> · Commercial Reg: <strong>{fac.commercialRegNo}</strong> ·
                    Contact: {fac.contactPerson} ({fac.phone})
                  </p>
                  {fac.kycDocumentFileId ? (
                    <button
                      type="button"
                      onClick={() => handleInspectKycDoc(fac.kycDocumentFileId, fac.kycDocumentName || 'KYC_Document')}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:underline pt-1"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Download Signed KYC Document ({fac.kycDocumentName || 'Protected File'})</span>
                    </button>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Document on file: {fac.kycDocumentName || 'Verified Registration File'}
                    </p>
                  )}
                  {fac.kycReviewNote && (
                    <p className="text-xs text-slate-500 italic">Audit Note: {fac.kycReviewNote}</p>
                  )}
                </div>

                {fac.kycStatus === 'pending' && (
                  <div className="w-full lg:w-96 space-y-2.5">
                    <input
                      type="text"
                      value={reviewReasons[fac.id] || ''}
                      onChange={(e) => setReviewReasons((prev) => ({ ...prev, [fac.id]: e.target.value }))}
                      placeholder="Mandatory audit note (e.g. Verified Tax Card & CR extract)"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-[#272F31]"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={kycBusyId === fac.id}
                        onClick={() => handleKycDecision(fac.id, 'approved')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-xs font-semibold text-white min-h-[38px]"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve KYC</span>
                      </button>
                      <button
                        type="button"
                        disabled={kycBusyId === fac.id}
                        onClick={() => handleKycDecision(fac.id, 'rejected')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-red-50 hover:bg-red-100 px-3 py-2 text-xs font-semibold text-red-700 min-h-[38px]"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Certified External 3PL Logistics Verification */}
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-[#272F31]">External 3PL Carrier Licensing & Governance</h2>
            {(data.providers || []).map((prov: any) => (
              <div
                key={prov.id}
                className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`font-bold ${
                        prov.isVerified ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {String(prov.verificationStatus || (prov.isVerified ? 'approved' : 'suspended')).toUpperCase()}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="font-mono font-semibold text-[#272F31]">
                      License: {prov.envTransportLicenseId}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="font-mono text-slate-600">On-Time: {prov.onTimeRate}%</span>
                  </div>
                  <h3 className="text-base font-bold text-[#272F31]">{prov.nameEn}</h3>
                  <p className="text-xs text-slate-500">
                    Dispatch: {prov.contactPhone} · Fleet Size: {prov.fleetCount} vehicles
                  </p>
                </div>

                <div className="w-full lg:w-96 space-y-2">
                  <input
                    type="text"
                    value={providerReasons[prov.id] || ''}
                    onChange={(e) => setProviderReasons((prev) => ({ ...prev, [prov.id]: e.target.value }))}
                    placeholder="Audit reason for license approval or suspension..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-[#272F31]"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={providerBusyId === prov.id}
                      onClick={() => handleProviderDecision(prov.id, 'approved')}
                      className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-xs font-semibold text-white"
                    >
                      Approve / Keep Active
                    </button>
                    <button
                      type="button"
                      disabled={providerBusyId === prov.id}
                      onClick={() => handleProviderDecision(prov.id, 'suspended')}
                      className="flex-1 rounded-lg border border-red-300 bg-red-50 hover:bg-red-100 px-3 py-2 text-xs font-semibold text-red-700"
                    >
                      Suspend Carrier
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: WASTE GENERATORS DIRECTORY */}
      {tab === 'hubs' && data && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              {(Object.keys(FACILITY_TYPE_LABELS) as FacilityType[]).map((ft) => (
                <div key={ft} className="flex items-center gap-1.5">
                  <span className="text-slate-500">{FACILITY_TYPE_LABELS[ft][lang]}:</span>
                  <span className="font-mono font-bold text-[#272F31]">{kpis?.generatorsByType?.[ft] ?? 0}</span>
                </div>
              ))}
            </div>
            <div className="inline-flex items-center p-1 rounded-lg bg-slate-100">
              <button
                type="button"
                onClick={() => setGeneratorView('table')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                  generatorView === 'table' ? 'bg-white text-[#272F31] shadow-xs' : 'text-slate-600 hover:text-[#272F31]'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>Table</span>
              </button>
              <button
                type="button"
                onClick={() => setGeneratorView('grid')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${
                  generatorView === 'grid' ? 'bg-white text-[#272F31] shadow-xs' : 'text-slate-600 hover:text-[#272F31]'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Grid</span>
              </button>
            </div>
          </div>

          {generatorView === 'table' ? (
            <div className="rounded-2xl bg-white border border-slate-200 overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-3 px-4 font-semibold">Facility Code & Name</th>
                    <th className="py-3 px-4 font-semibold">Facility Type & Governorate</th>
                    <th className="py-3 px-4 font-semibold text-right">Available + Reserved</th>
                    <th className="py-3 px-4 font-semibold">Capacity Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Purity</th>
                    <th className="py-3 px-4 font-semibold text-right">Governance Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.hubs.map((h: any) => (
                    <tr key={h.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-bold text-[#272F31]">{h.code}</div>
                        <div className="font-semibold text-slate-800">{h.nameEn}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-[#272F31]">
                          {FACILITY_TYPE_LABELS[h.hubType as FacilityType]?.[lang] || h.hubType}
                        </div>
                        <div className="text-slate-500">{h.governorate}</div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                        <span className="font-bold text-[#272F31]">
                          {h.availableTons.toFixed(1)} + {h.reservedTons.toFixed(1)} t
                        </span>
                        <span className="block text-slate-500">Max: {h.maxCapacityTons} t</span>
                      </td>
                      <td className="py-3.5 px-4 min-w-[180px]">
                        <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                          <span className={h.isHighCapacity ? 'font-bold text-amber-800' : 'text-slate-600'}>
                            {h.isHighCapacity ? `Warning: ${h.occupancyPct}% Capacity` : `Nominal: ${h.occupancyPct}%`}
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${h.isHighCapacity ? 'bg-amber-500' : 'bg-emerald-600'}`}
                            style={{ width: `${Math.min(100, h.occupancyPct)}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-700">
                        {h.purityScore.toFixed(1)}%
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          disabled={dispatchBusyId === h.id}
                          onClick={() => handleAssign3pl(h.id, h.nameEn)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#272F31] hover:bg-[#333D40] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap disabled:opacity-50"
                        >
                          <Truck className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{dispatchBusyId === h.id ? 'Assigning...' : t.admin.assignPickup}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.hubs.map((h: any) => (
                <div
                  key={h.id}
                  className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-bold text-emerald-700">{h.code}</span>
                      <span className="font-mono text-slate-500">Purity {h.purityScore.toFixed(1)}%</span>
                    </div>
                    <h3 className="text-sm font-bold text-[#272F31]">{h.nameEn}</h3>
                    <p className="text-xs text-slate-600">
                      {FACILITY_TYPE_LABELS[h.hubType as FacilityType]?.[lang] || h.hubType} · {h.governorate}
                    </p>
                    <div className="pt-2 space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className={h.isHighCapacity ? 'font-bold text-amber-800' : 'text-slate-600'}>
                          {h.isHighCapacity ? `Warning: ${h.occupancyPct}% Capacity` : `Nominal: ${h.occupancyPct}%`}
                        </span>
                        <span className="text-[#272F31] font-semibold">
                          {(h.availableTons + h.reservedTons).toFixed(1)} / {h.maxCapacityTons} t
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${h.isHighCapacity ? 'bg-amber-500' : 'bg-emerald-600'}`}
                          style={{ width: `${Math.min(100, h.occupancyPct)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={dispatchBusyId === h.id}
                    onClick={() => handleAssign3pl(h.id, h.nameEn)}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#272F31] hover:bg-[#333D40] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    <Truck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{dispatchBusyId === h.id ? 'Assigning...' : t.admin.assignPickup}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: OPERATIONAL DISPUTES DESK */}
      {tab === 'disputes' && data && (
        <div className="space-y-4">
          {(data.disputes || []).length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">
              No operational disputes logged.
            </div>
          ) : (
            (data.disputes || []).map((d: any) => (
              <div
                key={d.id}
                className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-col lg:flex-row lg:items-start justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Flag className="w-3.5 h-3.5 text-amber-600" />
                    <span className="font-mono font-bold text-[#272F31]">{d.disputeCode}</span>
                    <span className="text-slate-400">·</span>
                    <span
                      className={`font-bold uppercase ${
                        d.status === 'resolved'
                          ? 'text-emerald-700'
                          : d.status === 'dismissed'
                          ? 'text-slate-500'
                          : 'text-amber-700'
                      }`}
                    >
                      {d.status}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-600">{d.category}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500">{d.raisedByOrgName}</span>
                  </div>
                  <p className="text-xs text-slate-700 max-w-2xl leading-relaxed">{d.description}</p>
                  {d.resolutionNote && (
                    <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 inline-block mt-1">
                      Resolution ({d.resolvedByEmail || 'Admin'}): {d.resolutionNote}
                    </p>
                  )}
                </div>

                <div className="w-full lg:w-96 space-y-2 shrink-0">
                  <div className="flex items-center gap-2">
                    <select
                      value={disputeStatuses[d.id] || d.status}
                      onChange={(e) => setDisputeStatuses((p) => ({ ...p, [d.id]: e.target.value }))}
                      className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs bg-white text-[#272F31]"
                    >
                      <option value="open">Open</option>
                      <option value="investigating">Investigating</option>
                      <option value="resolved">Resolved</option>
                      <option value="dismissed">Dismissed</option>
                    </select>
                    <input
                      type="text"
                      value={disputeNotes[d.id] ?? d.resolutionNote ?? ''}
                      onChange={(e) => setDisputeNotes((p) => ({ ...p, [d.id]: e.target.value }))}
                      placeholder="Audit resolution note..."
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-[#272F31]"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={disputeBusyId === d.id}
                    onClick={() => handleResolveDispute(d.id, d.status)}
                    className="w-full rounded-lg bg-[#272F31] hover:bg-[#333D40] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {disputeBusyId === d.id ? 'Updating...' : 'Save Dispute Decision & Notify Party'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 5: USERS, LIVE EMISSION FACTORS & SYSTEM HEALTH */}
      {tab === 'governance' && data && (
        <div className="space-y-6">
          {/* System Health & Integrations */}
          {systemHealth && (
            <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-600" />
                  <h2 className="text-sm font-bold text-[#272F31]">Runtime System Health & Security Controls</h2>
                </div>
                <span className="font-mono text-xs font-bold text-emerald-700">
                  DB Connected · {systemHealth.database?.latencyMs} ms · Uptime {systemHealth.uptimeSeconds}s
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-1">
                  <p className="font-bold text-[#272F31]">Cloud SQL PostgreSQL Ledger</p>
                  <p className="text-slate-600 font-mono">
                    Passports: {systemHealth.database?.tables?.digitalWastePassports} · Reservations:{' '}
                    {systemHealth.database?.tables?.reservations} · Users: {systemHealth.database?.tables?.users}
                  </p>
                  <p className="text-slate-500 font-mono">
                    Vehicles: {systemHealth.database?.tables?.logisticsVehicles} · Files:{' '}
                    {systemHealth.database?.tables?.storedFiles}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-1">
                  <p className="font-bold text-[#272F31]">Private Document Storage</p>
                  <p className="text-emerald-700 font-semibold">Confined Private Disk + 5-Min Signed URLs</p>
                  <p className="text-slate-500">Magic-byte validation & SHA-256 checksums active</p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-1">
                  <p className="font-bold text-[#272F31]">Notification & Email Delivery</p>
                  <p className="text-slate-700 font-semibold">
                    In-App Ledger: Active · Email:{' '}
                    {systemHealth.notifications?.configured ? systemHealth.notifications.provider : 'Not Configured'}
                  </p>
                  <p className="text-slate-500">{systemHealth.notifications?.note}</p>
                </div>
              </div>
            </div>
          )}

          {/* Live PostgreSQL Emission Factors Editor */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-emerald-600" />
              <div>
                <h2 className="text-sm font-bold text-[#272F31]">ESG Emission Factors Registry (PostgreSQL)</h2>
                <p className="text-xs text-slate-500">
                  Used for Stage 7 net CO2e calculations (recovered tons × recycling factor − 3PL freight emissions).
                  Every update is versioned and audited.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-2.5 px-3 font-semibold">Material Category</th>
                    <th className="py-2.5 px-3 font-semibold">Recycling Factor (tCO2e/t)</th>
                    <th className="py-2.5 px-3 font-semibold">Freight Factor (kg/t·km)</th>
                    <th className="py-2.5 px-3 font-semibold">Version & Source</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Save</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data.emissionFactors || []).map((ef: any) => {
                    const draft = factorDrafts[ef.materialCategory] || {
                      co2eFactorPerTon: ef.co2eFactorPerTon,
                      transportFactorKgPerTonKm: ef.transportFactorKgPerTonKm,
                      version: ef.version,
                      reason: '',
                    };
                    return (
                      <tr key={ef.materialCategory}>
                        <td className="py-3 px-3">
                          <div className="font-mono font-bold text-[#272F31]">{ef.materialCategory}</div>
                          <div className="text-[11px] text-slate-500">{ef.methodologyName}</div>
                        </td>
                        <td className="py-3 px-3">
                          <input
                            type="number"
                            step="0.01"
                            value={draft.co2eFactorPerTon}
                            onChange={(e) =>
                              setFactorDrafts((prev) => ({
                                ...prev,
                                [ef.materialCategory]: { ...draft, co2eFactorPerTon: Number(e.target.value) },
                              }))
                            }
                            className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                          />
                        </td>
                        <td className="py-3 px-3">
                          <input
                            type="number"
                            step="0.001"
                            value={draft.transportFactorKgPerTonKm}
                            onChange={(e) =>
                              setFactorDrafts((prev) => ({
                                ...prev,
                                [ef.materialCategory]: {
                                  ...draft,
                                  transportFactorKgPerTonKm: Number(e.target.value),
                                },
                              }))
                            }
                            className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                          />
                        </td>
                        <td className="py-3 px-3">
                          <input
                            type="text"
                            value={draft.version}
                            onChange={(e) =>
                              setFactorDrafts((prev) => ({
                                ...prev,
                                [ef.materialCategory]: { ...draft, version: e.target.value },
                              }))
                            }
                            className="w-40 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                          />
                          <div className="text-[10px] text-slate-500 mt-0.5 truncate max-w-xs">{ef.sourceRef}</div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            disabled={factorBusyCat === ef.materialCategory}
                            onClick={() => handleSaveEmissionFactor(ef.materialCategory)}
                            className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {factorBusyCat === ef.materialCategory ? 'Saving...' : 'Update'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* User Accounts & RBAC Management */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-600" />
              <h2 className="text-sm font-bold text-[#272F31]">Platform User Accounts & RBAC Governance</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <th className="py-2.5 px-3 font-semibold">User & Code</th>
                    <th className="py-2.5 px-3 font-semibold">Email</th>
                    <th className="py-2.5 px-3 font-semibold">Assigned Role</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Access Control</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data.users || []).map((u: any) => (
                    <tr key={u.id}>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-[#272F31]">{u.fullName}</div>
                        <div className="font-mono text-[11px] text-slate-500">{u.accountCode}</div>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-700">{u.email}</td>
                      <td className="py-3 px-3">
                        <span className="font-semibold text-[#272F31]">
                          {ROLE_LABELS[u.role as UserRole]?.[lang] || u.role}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`font-bold ${u.isActive ? 'text-emerald-700' : 'text-red-700'}`}>
                          {u.isActive ? 'ACTIVE' : 'SUSPENDED'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          disabled={userBusyId === u.id}
                          onClick={() => handleToggleUserActive(u)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold border ${
                            u.isActive
                              ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                          } disabled:opacity-50`}
                        >
                          {u.isActive ? 'Suspend' : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: LIVE PASSPORT FEED & GOVERNANCE AUDIT LOG */}
      {tab === 'audit' && data && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
            <h2 className="text-sm font-bold text-[#272F31]">Live Digital Waste Passport Events (SHA-256 Chained)</h2>
            <div className="divide-y divide-slate-100">
              {data.recentEvents.map((ev: any) => (
                <div key={ev.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => onInspectPassport(ev.passportCode)}
                        className="font-mono font-bold text-emerald-700 hover:underline inline-flex items-center gap-1"
                      >
                        <QrCode className="w-3 h-3" />
                        <span>{ev.passportCode}</span>
                      </button>
                      <span className="text-slate-400">·</span>
                      <span className="font-semibold text-[#272F31]">Stage {ev.stage}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-slate-500">{ev.actorName}</span>
                    </div>
                    <p className="text-xs text-slate-700">{ev.summaryEn}</p>
                    {ev.eventHash && (
                      <p className="text-[10px] font-mono text-slate-400">SHA-256: {String(ev.eventHash).slice(0, 20)}…</p>
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap shrink-0">
                    {new Date(ev.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
            <h2 className="text-sm font-bold text-[#272F31] flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Admin Governance Audit Trail</span>
            </h2>
            <div className="divide-y divide-slate-100">
              {data.auditLogs.map((log: any) => (
                <div key={log.id} className="py-3 text-xs space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-[#272F31]">{log.action}</span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {new Date(log.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-slate-700">{log.reason}</p>
                  <p className="text-[11px] text-slate-400">By {log.actorEmail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Register New Waste Generator Facility Modal (with Google Places API New Search) */}
      {showNewHubModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#272F31]/65 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleCreateHub}
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-lg font-bold text-[#272F31]">Register New Waste Generator Facility</h3>
              <button
                type="button"
                onClick={() => setShowNewHubModal(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Search Location via Google Places API (New)
              </label>
              <PlacesAutocompleteInput
                onPlaceSelected={(place) => {
                  setNewHubAddress(place.address);
                  setNewHubLat(Number(place.lat.toFixed(5)));
                  setNewHubLng(Number(place.lng.toFixed(5)));
                  if (!newHubNameEn) setNewHubNameEn(place.name);
                }}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Facility Name (English)</label>
                <input
                  type="text"
                  required
                  value={newHubNameEn}
                  onChange={(e) => setNewHubNameEn(e.target.value)}
                  placeholder="e.g. Maadi Corporate Business Park"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#272F31]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Facility Name (Arabic)</label>
                <input
                  type="text"
                  value={newHubNameAr}
                  onChange={(e) => setNewHubNameAr(e.target.value)}
                  placeholder="مجمع المعادي الإداري للشركات"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#272F31]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Facility Type</label>
                <select
                  value={newHubType}
                  onChange={(e) => setNewHubType(e.target.value as FacilityType)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#272F31]"
                >
                  {(Object.keys(FACILITY_TYPE_LABELS) as FacilityType[]).map((ft) => (
                    <option key={ft} value={ft}>
                      {FACILITY_TYPE_LABELS[ft].en}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Governorate</label>
                <select
                  value={newHubGov}
                  onChange={(e) => setNewHubGov(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#272F31]"
                >
                  {GOVERNORATES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Commercial Registration No. (Optional)
                </label>
                <input
                  type="text"
                  value={newHubCrNo}
                  onChange={(e) => setNewHubCrNo(e.target.value)}
                  placeholder="e.g. CR-CAI-712400"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-[#272F31]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Full Address</label>
              <input
                type="text"
                required
                value={newHubAddress}
                onChange={(e) => setNewHubAddress(e.target.value)}
                placeholder="Street, District, Governorate, Egypt"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#272F31]"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Latitude</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={newHubLat}
                  onChange={(e) => setNewHubLat(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-[#272F31]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Longitude</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={newHubLng}
                  onChange={(e) => setNewHubLng(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-[#272F31]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Max Cap. (t)</label>
                <input
                  type="number"
                  min={5}
                  max={500}
                  required
                  value={newHubCapacity}
                  onChange={(e) => setNewHubCapacity(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-[#272F31]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={creatingHub}
              className="w-full min-h-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-colors disabled:opacity-50"
            >
              {creatingHub ? 'Registering Facility...' : 'Register Waste Generator Facility'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

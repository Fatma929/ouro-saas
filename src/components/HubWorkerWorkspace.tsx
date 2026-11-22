import React, { useEffect, useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Bluetooth,
  BluetoothConnected,
  Camera,
  CheckCircle2,
  Lock,
  Unlock,
  RotateCcw,
  Upload,
  WifiOff,
  RefreshCw,
  AlertTriangle,
  Loader2,
  ExternalLink,
  X,
  Leaf,
  FileCheck,
  FileText,
  Download,
  Pencil,
  Trash2,
  Truck,
  Flag,
} from 'lucide-react';
import { apiFetch, downloadAuthenticatedCsv } from '../lib/api.ts';
import { buildPassportQrUrl } from '../lib/passport-qr.ts';
import { PassportQRCode } from './PassportQRCode.tsx';
import { LifecycleBadge } from './ui/DesignSystem.tsx';
import { DisputeModal } from './DisputeModal.tsx';
import { useOnlineStatus } from '../hooks/usePWA.ts';
import {
  MATERIAL_METADATA,
  FACILITY_TYPE_LABELS,
  PICKUP_STATUS_LABELS,
  type MaterialCategory,
  type PurityGrade,
  type VerificationMethod,
  type FacilityType,
  type PickupStatus,
} from '../shared/constants.ts';
import { TRANSLATIONS, type Lang } from '../shared/i18n.ts';

interface HubWorkerWorkspaceProps {
  user: any;
  lang: Lang;
  onInspectPassport: (code: string) => void;
  onOpenEsgCertificate?: () => void;
}

interface QueuedLot {
  id: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

const OFFLINE_QUEUE_KEY = 'ouro_worker_offline_queue_v1';

export const HubWorkerWorkspace: React.FC<HubWorkerWorkspaceProps> = ({
  user,
  lang,
  onInspectPassport,
  onOpenEsgCertificate,
}) => {
  const t = TRANSLATIONS[lang];
  const isOnline = useOnlineStatus();

  const [hubs, setHubs] = useState<any[]>([]);
  const [selectedHubId, setSelectedHubId] = useState<number | null>(user.hubId || null);
  const [recentPassports, setRecentPassports] = useState<any[]>([]);
  const [incomingReservations, setIncomingReservations] = useState<any[]>([]);
  const [facilityEsg, setFacilityEsg] = useState({
    listedTons: 0,
    deliveredTons: 0,
    verifiedRecycledTons: 0,
    verifiedCo2eTons: 0,
    estimatedCo2eTons: 0,
    sealedPassportsCount: 0,
    deliveredPendingCount: 0,
    activePassportsCount: 0,
  });
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);

  // BLE Digital Scale State
  const [bleConnected, setBleConnected] = useState(false);
  const [bleDeviceName, setBleDeviceName] = useState<string | null>(null);
  const [bleStatusNote, setBleStatusNote] = useState<string | null>(null);
  const [verificationMethod, setVerificationMethod] = useState<VerificationMethod>('manual_calibrated');
  const [rawWeightKg, setRawWeightKg] = useState<number>(2450);
  const [tareOffsetKg, setTareOffsetKg] = useState<number>(0);
  const [weightLocked, setWeightLocked] = useState(false);

  // Lot Intake Form State
  const [materialCategory, setMaterialCategory] = useState<MaterialCategory>('paper_cardboard');
  const [materialSubtype, setMaterialSubtype] = useState<string>(
    MATERIAL_METADATA.paper_cardboard.subtypes[0]
  );
  const [purityGrade, setPurityGrade] = useState<PurityGrade>('Grade A');
  const [pricePerTonEgp, setPricePerTonEgp] = useState<number>(
    MATERIAL_METADATA.paper_cardboard.defaultRateEgp
  );
  const [pickupWindow, setPickupWindow] = useState('Tomorrow 08:00 - 13:00 EET');
  const [notes, setNotes] = useState('');

  // Photo & Supporting Doc Upload State
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [uploadedPhotoId, setUploadedPhotoId] = useState<number | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [supportingDocId, setSupportingDocId] = useState<number | null>(null);
  const [supportingDocName, setSupportingDocName] = useState<string | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Edit / Cancel / Dispute Modal State
  const [editingLot, setEditingLot] = useState<any | null>(null);
  const [editPrice, setEditPrice] = useState<number>(0);
  const [editGrade, setEditGrade] = useState<PurityGrade>('Grade A');
  const [editWindow, setEditWindow] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [disputeTarget, setDisputeTarget] = useState<{
    reservationId?: number;
    passportId?: number;
    label: string;
  } | null>(null);

  // Submission & Offline Queue
  const [submitting, setSubmitting] = useState(false);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newlyMintedPassport, setNewlyMintedPassport] = useState<any | null>(null);
  const [offlineQueue, setOfflineQueue] = useState<QueuedLot[]>(() => {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const loadWorkspace = useCallback(async () => {
    setLoadingWorkspace(true);
    try {
      const qs = selectedHubId && user.role === 'platform_admin' ? `?hubId=${selectedHubId}` : '';
      const data = await apiFetch(`/api/worker/workspace${qs}`);
      setHubs(data.hubs || []);
      if (data.assignedHub && !selectedHubId) {
        setSelectedHubId(data.assignedHub.id);
      }
      setRecentPassports(data.recentPassports || []);
      setIncomingReservations(data.incomingReservations || []);
      if (data.facilityEsg) {
        setFacilityEsg(data.facilityEsg);
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Could not load waste generator workspace.' });
    } finally {
      setLoadingWorkspace(false);
    }
  }, [selectedHubId, user.role]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(offlineQueue));
    } catch {
      // ignore quota errors
    }
  }, [offlineQueue]);

  const syncOfflineQueue = useCallback(async () => {
    if (!isOnline || offlineQueue.length === 0) return;
    setSyncingQueue(true);
    const remaining: QueuedLot[] = [];
    let syncedCount = 0;

    for (const item of offlineQueue) {
      try {
        await apiFetch('/api/passports', {
          method: 'POST',
          body: JSON.stringify(item.payload),
        });
        syncedCount += 1;
      } catch {
        remaining.push(item);
      }
    }

    setOfflineQueue(remaining);
    setSyncingQueue(false);
    if (syncedCount > 0) {
      setMessage({
        type: 'success',
        text: `Synced ${syncedCount} offline weigh-in lot(s) and minted Digital Waste Passports.`,
      });
      loadWorkspace();
    }
  }, [isOnline, offlineQueue, loadWorkspace]);

  useEffect(() => {
    if (isOnline && offlineQueue.length > 0) {
      syncOfflineQueue();
    }
  }, [isOnline, offlineQueue.length, syncOfflineQueue]);

  const activeHub = hubs.find((h) => h.id === selectedHubId) || hubs[0] || null;
  const isFacilityVerified =
    user.role === 'platform_admin' || !activeHub || activeHub.verificationStatus === 'verified';
  const netWeightKg = Math.max(0, Number((rawWeightKg - tareOffsetKg).toFixed(1)));
  const netWeightTons = Number((netWeightKg / 1000).toFixed(3));

  const occupiedTons = activeHub
    ? Number((activeHub.availableTons + activeHub.reservedTons).toFixed(2))
    : 0;
  const capacityPct =
    activeHub && activeHub.maxCapacityTons > 0
      ? Math.round((occupiedTons / activeHub.maxCapacityTons) * 100)
      : 0;

  // Real Web Bluetooth API (GATT Weight Scale Service 0x181D)
  const handleConnectBleScale = async () => {
    setBleStatusNote(null);
    const nav = navigator as any;
    if (!nav.bluetooth) {
      setBleStatusNote(
        'Web Bluetooth is unavailable in this browser context. Using Calibrated Manual Entry (tagged in audit log).'
      );
      setVerificationMethod('manual_calibrated');
      return;
    }

    try {
      const device = await nav.bluetooth.requestDevice({
        filters: [{ services: ['weight_scale'] }],
        optionalServices: [0x181d, 'battery_service'],
      });
      const server = await device.gatt?.connect();
      setBleConnected(true);
      setBleDeviceName(device.name || 'Industrial BLE Scale');
      setVerificationMethod('ble_scale');
      setBleStatusNote(`Connected to ${device.name || 'BLE Weight Scale'} via GATT (0x181D).`);

      try {
        const service = await server?.getPrimaryService(0x181d);
        const char = await service?.getCharacteristic(0x2a9d);
        await char?.startNotifications();
        char?.addEventListener('characteristicvaluechanged', (ev: any) => {
          if (weightLocked) return;
          const dv: DataView = ev.target.value;
          if (dv && dv.byteLength >= 3) {
            const flags = dv.getUint8(0);
            const raw = dv.getUint16(1, true);
            const resolution = flags & 0x01 ? 0.01 : 0.005;
            const kg = Math.round(raw * resolution * 100) / 100;
            if (kg > 0) setRawWeightKg(kg);
          }
        });
      } catch {
        setBleStatusNote(`Paired with ${device.name || 'BLE Scale'}. Ready to capture GATT readings.`);
      }

      device.addEventListener('gattserverdisconnected', () => {
        setBleConnected(false);
        setBleDeviceName(null);
        setVerificationMethod('manual_calibrated');
      });
    } catch (err: any) {
      setBleStatusNote(
        err?.name === 'NotFoundError'
          ? 'BLE scale pairing cancelled. Calibrated Manual Entry remains active.'
          : 'No compatible BLE scale paired. Using Calibrated Manual Entry fallback.'
      );
    }
  };

  const handleDisconnectBle = () => {
    setBleConnected(false);
    setBleDeviceName(null);
    setVerificationMethod('manual_calibrated');
    setBleStatusNote('Scale disconnected. Switched to Calibrated Manual Entry.');
  };

  const handleMaterialChange = (cat: MaterialCategory) => {
    setMaterialCategory(cat);
    const meta = MATERIAL_METADATA[cat];
    setMaterialSubtype(meta.subtypes[0]);
    setPricePerTonEgp(meta.defaultRateEgp);
  };

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    setMessage(null);
    try {
      setPhotoPreviewUrl(URL.createObjectURL(file));
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', 'weighin_photo');
      const uploaded = await apiFetch<{ id: number }>('/api/storage/upload', {
        method: 'POST',
        body: formData,
      });
      setUploadedPhotoId(uploaded.id);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Photo upload failed.' });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSupportingDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDoc(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', 'supporting_doc');
      const uploaded = await apiFetch<{ id: number; originalName: string }>('/api/storage/upload', {
        method: 'POST',
        body: formData,
      });
      setSupportingDocId(uploaded.id);
      setSupportingDocName(uploaded.originalName);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Supporting document upload failed.' });
    } finally {
      setUploadingDoc(false);
    }
  };

  const handlePublishLot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeHub) return;
    if (netWeightKg < 50) {
      setMessage({ type: 'error', text: 'Net verified weight must be at least 50 kg.' });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    const payload = {
      hubId: activeHub.id,
      materialCategory,
      materialSubtype,
      purityGrade,
      weightKg: netWeightKg,
      pricePerTonEgp,
      verificationMethod,
      photoFileId: uploadedPhotoId,
      supportingDocFileId: supportingDocId,
      supportingDocName,
      notes,
      pickupWindow,
      gpsLat: activeHub.lat,
      gpsLng: activeHub.lng,
    };

    if (!isOnline) {
      setOfflineQueue((prev) => [
        ...prev,
        { id: `OFF-${Date.now()}`, createdAt: new Date().toISOString(), payload },
      ]);
      setMessage({
        type: 'success',
        text: 'Saved to Offline Queue. Lot will mint and sync automatically when connection returns.',
      });
      setSubmitting(false);
      return;
    }

    try {
      const res = await apiFetch<{ passport: any; hub: any }>('/api/passports', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setNewlyMintedPassport({
        ...res.passport,
        hubName: res.hub ? (lang === 'ar' ? res.hub.nameAr : res.hub.nameEn) : activeHub.nameEn,
        hubCode: res.hub?.code || activeHub.code,
      });
      setMessage({
        type: 'success',
        text: `Minted Digital Waste Passport ${res.passport.passportCode} (${netWeightTons.toFixed(2)} tons — Status: LISTED). Scannable QR Bale Tag generated below.`,
      });
      setWeightLocked(false);
      setTareOffsetKg(0);
      setUploadedPhotoId(null);
      setPhotoPreviewUrl(null);
      setSupportingDocId(null);
      setSupportingDocName(null);
      setNotes('');
      await loadWorkspace();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Could not publish lot.' });
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (lot: any) => {
    setEditingLot(lot);
    setEditPrice(lot.pricePerTonEgp);
    setEditGrade(lot.purityGrade as PurityGrade);
    setEditWindow(lot.pickupWindow);
    setEditNotes(lot.notes || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLot) return;
    setSavingEdit(true);
    try {
      await apiFetch(`/api/passports/${editingLot.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          pricePerTonEgp: editPrice,
          purityGrade: editGrade,
          pickupWindow: editWindow,
          notes: editNotes,
        }),
      });
      setMessage({ type: 'success', text: `Updated listing ${editingLot.passportCode}.` });
      setEditingLot(null);
      await loadWorkspace();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to update listing.' });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCancelLot = async (lot: any) => {
    try {
      await apiFetch(`/api/passports/${lot.id}`, { method: 'DELETE' });
      setMessage({ type: 'success', text: `Cancelled unreserved listing ${lot.passportCode}.` });
      await loadWorkspace();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to cancel listing.' });
    }
  };

  const handleExportGeneratorCsv = async () => {
    try {
      await downloadAuthenticatedCsv(
        '/api/generator/transactions.csv',
        `OURO_Generator_Waste_Ledger_${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'CSV export failed.' });
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Strict Facility Verification Pending / Suspended Banner */}
      {activeHub && !isFacilityVerified && (
        <div
          className={`rounded-xl border p-4 flex items-start gap-3 ${
            activeHub.verificationStatus === 'suspended'
              ? 'border-red-300 bg-red-50 text-red-900'
              : 'border-amber-300 bg-amber-50 text-amber-950'
          }`}
        >
          <AlertTriangle
            className={`w-5 h-5 shrink-0 mt-0.5 ${
              activeHub.verificationStatus === 'suspended' ? 'text-red-600' : 'text-amber-600'
            }`}
          />
          <div className="space-y-1">
            <h2 className="text-sm font-bold">
              {activeHub.verificationStatus === 'suspended'
                ? lang === 'ar'
                  ? 'تم تعليق صلاحية إدراج المنشأة مؤقتاً'
                  : 'Waste Generator Listing Access Suspended'
                : lang === 'ar'
                ? 'المنشأة قيد مراجعة الاعتماد — الإدراج في السوق موقوف مؤقتاً'
                : 'Facility Verification Pending — Marketplace Listing Locked'}
            </h2>
            <p className="text-xs leading-relaxed">
              {activeHub.verificationStatus === 'suspended'
                ? 'Your facility account is suspended by OURO Platform Compliance. Contact operations to resolve.'
                : 'Your B2B Waste Generator registration has been received. Publishing new Digital Waste Passports to the marketplace unlocks automatically once an OURO Admin verifies your commercial registration.'}
            </p>
            <p className="text-xs font-mono opacity-80 pt-0.5">
              Facility Code: {activeHub.code} · CR: {activeHub.commercialRegNo || 'Submitted'} · Status:{' '}
              {String(activeHub.verificationStatus).toUpperCase()}
            </p>
          </div>
        </div>
      )}

      {/* Waste Generator Facility Header & Storage Occupancy Bar */}
      <div className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-mono font-semibold text-[#272F31]">
              {activeHub ? activeHub.code : 'Loading Facility...'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {activeHub
                ? FACILITY_TYPE_LABELS[activeHub.hubType as FacilityType]?.[lang] || activeHub.hubType
                : ''}
            </span>
            <span aria-hidden="true">·</span>
            <span>{activeHub?.governorate}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#272F31]">{t.worker.title}</h1>
          {activeHub && (
            <p className="text-sm text-slate-600">
              {lang === 'ar' ? activeHub.nameAr : activeHub.nameEn} — {activeHub.address}
            </p>
          )}
          {user.role === 'platform_admin' && hubs.length > 1 && (
            <div className="pt-1">
              <select
                value={selectedHubId || ''}
                onChange={(e) => setSelectedHubId(Number(e.target.value))}
                className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-[#272F31]"
              >
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.code} — {h.nameEn}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Capacity Readout with Explicit Text Warning >=80% */}
        {activeHub && (
          <div className="w-full lg:w-80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-600">{t.worker.hubCapacity}</span>
              <span
                className={`font-mono font-bold tabular-nums ${
                  capacityPct >= 80 ? 'text-amber-700' : 'text-[#272F31]'
                }`}
              >
                {occupiedTons.toFixed(1)} / {activeHub.maxCapacityTons} t ({capacityPct}%)
              </span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  capacityPct >= 80 ? 'bg-amber-500' : 'bg-emerald-600'
                }`}
                style={{ width: `${Math.min(100, capacityPct)}%` }}
              />
            </div>
            {capacityPct >= 80 && (
              <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>High Occupancy Warning ({capacityPct}%): Dispatch 3PL clearance soon.</span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Facility ESG Impact Banner — Strictly Separating LISTED / DELIVERED / VERIFIED RECYCLED */}
      <section className="rounded-2xl bg-[#272F31] text-white p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1 flex-1">
          <p className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
            <Leaf className="w-3.5 h-3.5" />
            <span>
              {lang === 'ar'
                ? 'لوحة تتبع المخلفات والأثر البيئي المعتمد للمنشأة (ESG)'
                : 'Facility Circular Ledger — Listed vs. Delivered vs. Verified Recycled'}
            </span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 pt-2">
            <div>
              <p className="text-[11px] text-slate-300">Listed Tonnage</p>
              <p className="text-xl font-extrabold font-mono tabular-nums text-white">
                {facilityEsg.listedTons.toFixed(2)} t
              </p>
            </div>
            <div>
              <p className="text-[11px] text-amber-200">Delivered (Pending Proof)</p>
              <p className="text-xl font-extrabold font-mono tabular-nums text-amber-300">
                {facilityEsg.deliveredTons.toFixed(2)} t
              </p>
            </div>
            <div>
              <p className="text-[11px] text-emerald-200">Verified Recycled Output</p>
              <p className="text-xl font-extrabold font-mono tabular-nums text-emerald-400">
                {facilityEsg.verifiedRecycledTons.toFixed(2)} t
              </p>
            </div>
            <div>
              <p className="text-[11px] text-emerald-200">Verified Net CO2e</p>
              <p className="text-xl font-extrabold font-mono tabular-nums text-emerald-300">
                {facilityEsg.verifiedCo2eTons.toFixed(2)} tCO2e
              </p>
              <p className="text-[10px] text-slate-400 font-mono">
                Est. unverified: {facilityEsg.estimatedCo2eTons.toFixed(1)} t
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportGeneratorCsv}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/20 px-3.5 py-2.5 text-xs font-bold text-white transition-colors whitespace-nowrap min-h-[42px]"
          >
            <Download className="w-4 h-4 text-[#C4A87E]" />
            <span>Export CSV</span>
          </button>
          {onOpenEsgCertificate && (
            <button
              type="button"
              onClick={onOpenEsgCertificate}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-xs font-bold text-white transition-colors whitespace-nowrap min-h-[42px]"
            >
              <FileCheck className="w-4 h-4" />
              <span>{lang === 'ar' ? 'شهادة ESG للمنشأة' : 'Facility ESG Certificate'}</span>
            </button>
          )}
        </div>
      </section>

      {/* Offline Queue Banner */}
      {offlineQueue.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-sm text-amber-900">
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>{offlineQueue.length}</strong> weigh-in lot(s) waiting in {t.worker.offlineQueue}.
            </span>
          </div>
          <button
            type="button"
            onClick={syncOfflineQueue}
            disabled={!isOnline || syncingQueue}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#272F31] px-4 py-2 text-xs font-semibold text-white hover:bg-[#333D40] disabled:opacity-50 min-h-[44px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingQueue ? 'animate-spin' : ''}`} />
            <span>{t.worker.syncNow}</span>
          </button>
        </div>
      )}

      {message && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm font-medium flex items-center justify-between gap-2 ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
          <button type="button" onClick={() => setMessage(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Immediately Rendered Scannable QR Card Upon Minting */}
      {newlyMintedPassport && (
        <section
          aria-label="Minted Digital Waste Passport QR"
          className="rounded-2xl border-2 border-emerald-500 bg-emerald-50/40 p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <h2 className="text-base font-extrabold text-[#272F31]">
                  {lang === 'ar'
                    ? 'تم إصدار جواز المخلفات — رمز QR جاهز للمسح الميداني'
                    : 'Digital Waste Passport Minted — Ready for On-Site Scanning'}
                </h2>
                <p className="text-xs text-slate-600">
                  {newlyMintedPassport.materialSubtype} ({newlyMintedPassport.purityGrade}) ·{' '}
                  <span className="font-mono font-semibold text-[#272F31]">
                    {newlyMintedPassport.initialWeightKg?.toLocaleString()} kg (
                    {newlyMintedPassport.availableTons?.toFixed(2)} t)
                  </span>
                </p>
              </div>
            </div>
            <div className="no-print flex items-center gap-2">
              <button
                type="button"
                onClick={() => onInspectPassport(newlyMintedPassport.passportCode)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-2 text-xs font-semibold text-[#272F31] min-h-[36px]"
              >
                <ExternalLink className="w-3.5 h-3.5 text-emerald-600" />
                <span>Open Full 7-Stage Passport</span>
              </button>
              <button
                type="button"
                onClick={() => setNewlyMintedPassport(null)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-500"
                aria-label="Dismiss minted QR panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <PassportQRCode
            lang={lang}
            variant="minted"
            size={144}
            meta={{
              passportCode: newlyMintedPassport.passportCode,
              materialSubtype: newlyMintedPassport.materialSubtype,
              purityGrade: newlyMintedPassport.purityGrade,
              weightKg: newlyMintedPassport.initialWeightKg,
              availableTons: newlyMintedPassport.availableTons,
              hubName: newlyMintedPassport.hubName,
              hubCode: newlyMintedPassport.hubCode,
              verificationMethod: newlyMintedPassport.verificationMethod,
              currentStage: newlyMintedPassport.currentStage,
              createdAt: newlyMintedPassport.createdAt,
            }}
          />
        </section>
      )}

      {/* Main 2-Column Field Intake + Facility Passports & Incoming Shipments */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Digital Scale Instrument & Intake Form */}
        <form
          onSubmit={handlePublishLot}
          className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-5 sm:p-6 space-y-6"
        >
          {/* Industrial Digital Scale Readout Panel */}
          <div className="rounded-xl bg-[#272F31] text-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-emerald-300">
                  {verificationMethod === 'ble_scale' ? t.worker.bleMode : t.worker.manualFallback}
                </p>
                <p className="text-xs text-slate-300 mt-0.5">
                  {bleConnected && bleDeviceName
                    ? `Paired Device: ${bleDeviceName}`
                    : 'Audit Tag: manual_calibrated (until BLE GATT scale paired)'}
                </p>
              </div>
              {bleConnected ? (
                <button
                  type="button"
                  onClick={handleDisconnectBle}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2.5 text-xs font-semibold text-white min-h-[44px]"
                >
                  <BluetoothConnected className="w-4 h-4" />
                  <span>{t.worker.disconnectScale}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectBleScale}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 px-3.5 py-2.5 text-xs font-semibold text-white min-h-[44px] transition-colors"
                >
                  <Bluetooth className="w-4 h-4 text-emerald-300" />
                  <span>{t.worker.connectScale}</span>
                </button>
              )}
            </div>

            <div className="rounded-lg bg-[#1C2325] border border-white/10 px-5 py-4 flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <p className="text-[11px] font-mono text-slate-400">NET VERIFIED WEIGHT</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-4xl sm:text-5xl font-bold font-mono tabular-nums text-emerald-400">
                    {netWeightKg.toLocaleString('en-US', { minimumFractionDigits: 1 })}
                  </span>
                  <span className="text-base font-mono text-slate-300">kg</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-mono text-slate-400">METRIC TONS</p>
                <p className="text-2xl font-bold font-mono tabular-nums text-white mt-1">
                  {netWeightTons.toFixed(3)} t
                </p>
                {weightLocked && (
                  <p className="text-[11px] font-semibold text-emerald-300 mt-0.5">WEIGHT LOCKED</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setTareOffsetKg(rawWeightKg)}
                disabled={weightLocked}
                className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white disabled:opacity-40"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{t.worker.tareScale}</span>
              </button>
              <button
                type="button"
                onClick={() => setWeightLocked((l) => !l)}
                className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold ${
                  weightLocked
                    ? 'bg-amber-500 text-[#272F31] hover:bg-amber-400'
                    : 'bg-emerald-600 text-white hover:bg-emerald-500'
                }`}
              >
                {weightLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                <span>{weightLocked ? t.worker.unlockWeight : t.worker.lockWeight}</span>
              </button>
              <button
                type="button"
                onClick={() => setTareOffsetKg(0)}
                disabled={weightLocked || tareOffsetKg === 0}
                className="col-span-2 sm:col-span-1 min-h-[44px] rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-300 disabled:opacity-40"
              >
                Reset Tare ({tareOffsetKg} kg)
              </button>
            </div>

            <div className="pt-2 border-t border-white/10">
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Calibrated Gross Weight Input (kg) — Auto-tagged as{' '}
                <span className="font-mono text-emerald-300">{verificationMethod}</span>
              </label>
              <input
                type="number"
                min={50}
                max={100000}
                step={10}
                disabled={weightLocked}
                value={rawWeightKg}
                onChange={(e) => {
                  setRawWeightKg(Number(e.target.value) || 0);
                  if (!bleConnected) setVerificationMethod('manual_calibrated');
                }}
                className="w-full min-h-[44px] rounded-lg bg-white/10 border border-white/20 px-4 py-2.5 text-base font-mono font-bold text-white focus:border-emerald-400 focus:outline-none disabled:opacity-50"
              />
              {bleStatusNote && (
                <p className="text-[11px] text-emerald-200/90 mt-1.5">{bleStatusNote}</p>
              )}
            </div>
          </div>

          {/* Sorting Classification, Pricing & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Non-Hazardous Material Category
              </label>
              <select
                value={materialCategory}
                onChange={(e) => handleMaterialChange(e.target.value as MaterialCategory)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-[#272F31] focus:border-emerald-600 focus:outline-none"
              >
                {(Object.keys(MATERIAL_METADATA) as MaterialCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {MATERIAL_METADATA[cat][lang]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Sorted Sub-Grade Specification
              </label>
              <select
                value={materialSubtype}
                onChange={(e) => setMaterialSubtype(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-[#272F31] focus:border-emerald-600 focus:outline-none"
              >
                {MATERIAL_METADATA[materialCategory].subtypes.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Sorting Purity Grade
              </label>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl">
                {(['Grade A', 'Grade B', 'Grade C'] as PurityGrade[]).map((grade) => (
                  <button
                    key={grade}
                    type="button"
                    onClick={() => setPurityGrade(grade)}
                    className={`min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                      purityGrade === grade
                        ? 'bg-[#272F31] text-white shadow-xs'
                        : 'text-slate-600 hover:text-[#272F31]'
                    }`}
                  >
                    {grade}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Listing Rate (EGP / Metric Ton)
              </label>
              <input
                type="number"
                min={500}
                step={50}
                value={pricePerTonEgp}
                onChange={(e) => setPricePerTonEgp(Number(e.target.value) || 0)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-mono font-bold text-[#272F31] focus:border-emerald-600 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Available 3PL Loading Window
              </label>
              <input
                type="text"
                value={pickupWindow}
                onChange={(e) => setPickupWindow(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-[#272F31] focus:border-emerald-600 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Handling / Baling Notes (Optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., Forklift available at Dock B, moisture < 8%, 12 compressed bales"
                className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-[#272F31] focus:border-emerald-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Photo & Supporting Compliance Document Capture */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                {t.worker.capturePhoto}
              </label>
              <label className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-[#F8FAFC] hover:bg-slate-100 px-3 py-2.5 cursor-pointer text-xs font-semibold text-[#272F31]">
                {uploadingPhoto ? (
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                ) : (
                  <Camera className="w-4 h-4 text-emerald-600" />
                )}
                <span>
                  {uploadingPhoto
                    ? 'Uploading...'
                    : uploadedPhotoId
                    ? 'Photo Stored ✓'
                    : 'Capture / Upload Photo'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoCapture}
                  className="hidden"
                />
              </label>
              {photoPreviewUrl && (
                <img
                  src={photoPreviewUrl}
                  alt="Lot preview"
                  referrerPolicy="no-referrer"
                  className="w-24 h-14 object-cover rounded-lg border border-slate-200"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Supporting Manifest / Spec PDF (Optional)
              </label>
              <label className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-[#F8FAFC] hover:bg-slate-100 px-3 py-2.5 cursor-pointer text-xs font-semibold text-[#272F31]">
                {uploadingDoc ? (
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                ) : (
                  <FileText className="w-4 h-4 text-amber-700" />
                )}
                <span className="truncate max-w-[180px]">
                  {uploadingDoc
                    ? 'Validating...'
                    : supportingDocName
                    ? supportingDocName
                    : 'Attach PDF / Text Manifest'}
                </span>
                <input
                  type="file"
                  accept=".pdf,.txt,image/*"
                  onChange={handleSupportingDocUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || uploadingPhoto || uploadingDoc || !isFacilityVerified}
            className="w-full min-h-[52px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : !isFacilityVerified ? (
              <>
                <Lock className="w-5 h-5" />
                <span>
                  {lang === 'ar'
                    ? 'بانتظار اعتماد المنشأة لنشر الدفعات'
                    : 'Awaiting Compliance Verification to Publish'}
                </span>
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" />
                <span>{t.worker.publishLot}</span>
              </>
            )}
          </button>
        </form>

        {/* Right Column: Facility Passports (with Edit/Cancel) + Incoming Reservations */}
        <div className="lg:col-span-5 space-y-6">
          {/* Facility Passports */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-[#272F31]">Facility Digital Waste Passports</h2>
                <p className="text-xs text-slate-500">
                  Manage active listings, inspect QR custody trails & mass balance
                </p>
              </div>
              <span className="font-mono text-xs font-semibold text-slate-500">
                {recentPassports.length} lots
              </span>
            </div>

            {loadingWorkspace ? (
              <div className="py-10 flex justify-center text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : recentPassports.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">
                No lots published from this facility yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {recentPassports.map((p) => {
                  const canEdit = p.status !== 'cancelled' && p.lifecycleStatus !== 'RECYCLED';
                  const canCancel =
                    p.status !== 'cancelled' &&
                    p.reservedTons === 0 &&
                    p.deliveredTons === 0 &&
                    p.recycledTons === 0;

                  return (
                    <div key={p.id} className="py-3.5 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <button
                            type="button"
                            onClick={() => onInspectPassport(p.passportCode)}
                            className="font-mono font-bold text-emerald-700 hover:underline"
                          >
                            {p.passportCode}
                          </button>
                          <LifecycleBadge status={p.lifecycleStatus} lang={lang} />
                          {p.status === 'cancelled' && (
                            <span className="text-[10px] font-bold uppercase text-red-600">CANCELLED</span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-[#272F31] truncate">
                          {p.materialSubtype} ({p.purityGrade})
                        </p>
                        <p className="text-xs text-slate-500 font-mono tabular-nums">
                          Avail: {p.availableTons.toFixed(2)} t · Res: {p.reservedTons.toFixed(2)} t ·
                          Deliv: {p.deliveredTons.toFixed(2)} t · Recyc: {p.recycledTons.toFixed(2)} t
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(p)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-[#272F31]"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Edit</span>
                            </button>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => handleCancelLot(p)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:text-red-800"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Cancel</span>
                            </button>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onInspectPassport(p.passportCode)}
                        className="shrink-0 bg-white p-1 rounded-lg border border-slate-200 hover:border-emerald-600"
                        title="Open Passport QR"
                      >
                        <QRCodeSVG
                          value={buildPassportQrUrl(p.passportCode)}
                          size={44}
                          fgColor="#272F31"
                          bgColor="#FFFFFF"
                          level="M"
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Incoming Factory Reservations & 3PL Pickup Status */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#272F31] flex items-center gap-1.5">
                <Truck className="w-4 h-4 text-emerald-600" />
                <span>Incoming Reservations & 3PL Pickups</span>
              </h2>
              <span className="font-mono text-xs text-slate-500">{incomingReservations.length}</span>
            </div>

            {incomingReservations.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No factory reservations yet for this facility.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {incomingReservations.slice(0, 8).map((r) => (
                  <div key={r.id} className="py-3 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-[#272F31]">{r.reservationCode}</span>
                      <span className="font-semibold text-emerald-700 capitalize">
                        {PICKUP_STATUS_LABELS[r.pickupStatus as PickupStatus]?.[lang] || r.pickupStatus}
                      </span>
                    </div>
                    <p className="text-slate-700">
                      Buyer: <strong>{r.factoryNameEn}</strong> · {r.quantityTons.toFixed(2)} t
                    </p>
                    <p className="text-slate-500">
                      3PL: {r.providerNameEn} ({r.providerLicenseId})
                    </p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="font-mono text-[11px] text-slate-600">
                        {r.recyclingStatus === 'verified_recycled'
                          ? `Verified Recycled: ${r.recoveredTons} t (+${r.co2eAvoidedTons} tCO2e)`
                          : r.pickupStatus === 'delivered'
                          ? 'Delivered — Awaiting Recycler Verification'
                          : r.pickupWindow}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setDisputeTarget({
                            reservationId: r.id,
                            passportId: r.passportId,
                            label: `${r.reservationCode} / ${r.passportCode}`,
                          })
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 hover:underline"
                      >
                        <Flag className="w-3 h-3" />
                        <span>Report Issue</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Listing Modal */}
      {editingLot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#272F31]/65 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#272F31]">
                Edit Listing {editingLot.passportCode}
              </h3>
              <button type="button" onClick={() => setEditingLot(null)}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Listing Rate (EGP / ton)
              </label>
              <input
                type="number"
                min={500}
                value={editPrice}
                onChange={(e) => setEditPrice(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Purity Grade</label>
              <select
                value={editGrade}
                onChange={(e) => setEditGrade(e.target.value as PurityGrade)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="Grade A">Grade A</option>
                <option value="Grade B">Grade B</option>
                <option value="Grade C">Grade C</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Pickup Window</label>
              <input
                type="text"
                value={editWindow}
                onChange={(e) => setEditWindow(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
              <input
                type="text"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingLot(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-semibold text-white"
              >
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
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
          setMessage({ type: 'success', text: 'Dispute submitted to OURO Platform Operations.' })
        }
      />
    </div>
  );
};

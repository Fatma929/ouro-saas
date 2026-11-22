import React, { useRef, useState } from 'react';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import {
  Download,
  Printer,
  Copy,
  Check,
  Maximize2,
  X,
  ShieldCheck,
  FileCode2,
} from 'lucide-react';
import { buildPassportQrUrl } from '../lib/passport-qr.ts';
import { TRANSLATIONS, type Lang } from '../shared/i18n.ts';

export interface PassportQrMeta {
  passportCode: string;
  materialSubtype?: string;
  purityGrade?: string;
  weightKg?: number;
  availableTons?: number;
  hubName?: string;
  hubCode?: string;
  verificationMethod?: string;
  currentStage?: number;
  createdAt?: string;
}

interface PassportQRCodeProps {
  meta: PassportQrMeta;
  lang: Lang;
  size?: number;
  variant?: 'card' | 'minted';
  showActions?: boolean;
}

export const PassportQRCode: React.FC<PassportQRCodeProps> = ({
  meta,
  lang,
  size = 132,
  variant = 'card',
  showActions = true,
}) => {
  const t = TRANSLATIONS[lang];
  const qrValue = buildPassportQrUrl(meta.passportCode);
  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  const exportCanvasWrapRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(qrValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback copy via temporary input
      const input = document.createElement('input');
      input.value = qrValue;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  /**
   * Renders a print-ready high-resolution PNG Bale Tag compositing the
   * scannable QR code canvas with lot metadata for physical lot labeling.
   */
  const handleDownloadPngTag = () => {
    const qrCanvas = exportCanvasWrapRef.current?.querySelector('canvas');
    if (!qrCanvas) return;

    const width = 640;
    const height = 840;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // White background with subtle border
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // Top OURO Charcoal header bar
    ctx.fillStyle = '#272F31';
    ctx.fillRect(0, 0, width, 116);

    // Dual-tone OURO Teal & Brushed Gold accent stripe
    ctx.fillStyle = '#3D7568';
    ctx.fillRect(0, 116, width / 2, 8);
    ctx.fillStyle = '#A88B64';
    ctx.fillRect(width / 2, 116, width / 2, 8);

    // Brand text
    ctx.fillStyle = '#FBFCFD';
    ctx.font = 'bold 34px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText('OURO', 36, 58);

    ctx.fillStyle = '#C4A87E';
    ctx.font = '600 15px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText('DIGITAL WASTE PASSPORT · ON-SITE BALE TAG', 36, 90);

    // Stage badge on right
    if (meta.currentStage) {
      ctx.fillStyle = '#FBFCFD';
      ctx.font = 'bold 18px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`STAGE ${meta.currentStage}/7`, width - 36, 62);
      ctx.textAlign = 'left';
    }

    // Centered crisp QR Code with white quiet frame
    const qrDrawSize = 360;
    const qrX = Math.round((width - qrDrawSize) / 2);
    const qrY = 158;
    ctx.strokeStyle = '#D1D6D7';
    ctx.lineWidth = 2;
    ctx.strokeRect(qrX - 14, qrY - 14, qrDrawSize + 28, qrDrawSize + 28);
    ctx.drawImage(qrCanvas, qrX, qrY, qrDrawSize, qrDrawSize);

    // Passport Code in large monospace
    ctx.fillStyle = '#272F31';
    ctx.font = 'bold 30px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(meta.passportCode, width / 2, 578);

    // Divider line
    ctx.strokeStyle = '#E2E7E7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, 602);
    ctx.lineTo(width - 40, 602);
    ctx.stroke();

    // Structured Lot Details
    ctx.textAlign = 'left';
    const rows: Array<[string, string]> = [
      ['MATERIAL', `${meta.materialSubtype || 'Recyclable Lot'}${meta.purityGrade ? ` (${meta.purityGrade})` : ''}`],
      [
        'VERIFIED WEIGHT',
        meta.weightKg
          ? `${meta.weightKg.toLocaleString()} kg (${(meta.weightKg / 1000).toFixed(2)} metric tons)`
          : meta.availableTons
          ? `${meta.availableTons.toFixed(2)} metric tons`
          : 'Scale Verified',
      ],
      ['WASTE GENERATOR', meta.hubName ? `${meta.hubName}${meta.hubCode ? ` (${meta.hubCode})` : ''}` : meta.hubCode || 'Verified Facility'],
      [
        'VERIFICATION',
        meta.verificationMethod === 'ble_scale'
          ? 'Bluetooth Digital Scale (GATT)'
          : 'Calibrated Manual Entry',
      ],
    ];

    let y = 640;
    for (const [label, value] of rows) {
      ctx.fillStyle = '#5C696C';
      ctx.font = 'bold 13px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillText(label, 44, y);

      ctx.fillStyle = '#272F31';
      ctx.font = '600 17px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillText(value.slice(0, 56), 44, y + 22);
      y += 46;
    }

    // Footer verification URL hint
    ctx.fillStyle = '#3D7568';
    ctx.font = '600 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SCAN ON-SITE WITH OURO GENERATOR / 3PL DRIVER APP', width / 2, height - 20);

    const link = document.createElement('a');
    link.download = `${meta.passportCode}_Bale_Tag.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleDownloadSvg = () => {
    const svgEl = svgContainerRef.current?.querySelector('svg');
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${meta.passportCode}_QR.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintTag = () => {
    window.print();
  };

  const isMinted = variant === 'minted';

  return (
    <>
      <div
        className={`rounded-xl border p-4 ${
          isMinted
            ? 'border-emerald-300 bg-white shadow-sm'
            : 'border-slate-200 bg-[#F6F7F7]'
        }`}
      >
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
          {/* Live Vector QR Code generated via qrcode.react */}
          <button
            type="button"
            onClick={() => setZoomOpen(true)}
            title="Tap to enlarge for on-site scanning"
            className="group relative bg-white p-2.5 rounded-xl border-2 border-[#272F31]/15 hover:border-emerald-600 transition-colors shrink-0 shadow-xs"
          >
            <div ref={svgContainerRef}>
              <QRCodeSVG
                value={qrValue}
                size={size}
                fgColor="#272F31"
                bgColor="#FFFFFF"
                level="H"
                marginSize={2}
              />
            </div>
            <span className="no-print absolute bottom-1.5 right-1.5 inline-flex items-center justify-center w-6 h-6 rounded-md bg-[#272F31]/85 text-white opacity-0 group-hover:opacity-100 transition-opacity">
              <Maximize2 className="w-3.5 h-3.5" />
            </span>
          </button>

          {/* Hidden high-res canvas used strictly for crisp PNG bale tag export */}
          <div ref={exportCanvasWrapRef} className="hidden" aria-hidden="true">
            <QRCodeCanvas
              value={qrValue}
              size={360}
              fgColor="#272F31"
              bgColor="#FFFFFF"
              level="H"
              marginSize={2}
            />
          </div>

          <div className="flex-1 min-w-0 w-full text-center sm:text-start space-y-2">
            <div>
              <p className="text-xs font-semibold text-emerald-700 flex items-center justify-center sm:justify-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>{t.passport.qrLabel}</span>
              </p>
              <p className="font-mono text-base font-extrabold text-[#272F31] tracking-tight break-all mt-0.5">
                {meta.passportCode}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                {meta.verificationMethod === 'ble_scale'
                  ? 'Verified via Bluetooth Digital Scale (GATT)'
                  : 'Verified via Calibrated Manual Entry'}
              </p>
            </div>

            {showActions && (
              <div className="no-print flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setZoomOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#272F31] hover:bg-[#333D40] px-3 py-2 text-xs font-semibold text-white transition-colors min-h-[36px]"
                >
                  <Maximize2 className="w-3.5 h-3.5 text-emerald-300" />
                  <span>{lang === 'ar' ? 'عرض للمسح' : 'Scan View'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadPngTag}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition-colors min-h-[36px]"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{lang === 'ar' ? 'تنزيل ملصق PNG' : 'Bale Tag PNG'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadSvg}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-2 text-xs font-semibold text-[#272F31] transition-colors min-h-[36px]"
                  title="Download Vector SVG QR"
                >
                  <FileCode2 className="w-3.5 h-3.5 text-slate-600" />
                  <span>SVG</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintTag}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-2 text-xs font-semibold text-[#272F31] transition-colors min-h-[36px]"
                  title="Print QR Bale Tag"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-600" />
                  <span>{lang === 'ar' ? 'طباعة' : 'Print'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-2 text-xs font-semibold text-[#272F31] transition-colors min-h-[36px]"
                  title="Copy scannable verification link"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">{lang === 'ar' ? 'تم النسخ' : 'Copied'}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-600" />
                      <span>{lang === 'ar' ? 'نسخ الرابط' : 'Copy Link'}</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* High-Contrast Full-Screen On-Site Scan Modal (Driver / Field Worker Handoff) */}
      {zoomOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-[#272F31]/85 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Scannable QR Code for ${meta.passportCode}`}
        >
          <div className="w-full max-w-md rounded-2xl bg-white text-[#272F31] shadow-2xl border border-slate-200 overflow-hidden">
            <div className="no-print flex items-center justify-between bg-[#272F31] text-white px-5 py-3.5">
              <div>
                <p className="text-[11px] font-semibold text-emerald-300 uppercase tracking-wide">
                  On-Site Scannable Passport
                </p>
                <p className="font-mono text-sm font-bold">{meta.passportCode}</p>
              </div>
              <button
                type="button"
                onClick={() => setZoomOpen(false)}
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white"
                aria-label="Close full-screen QR"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 flex flex-col items-center text-center space-y-4">
              <div className="p-4 bg-white rounded-2xl border-2 border-[#272F31]/15 shadow-xs">
                <QRCodeSVG
                  value={qrValue}
                  size={256}
                  fgColor="#272F31"
                  bgColor="#FFFFFF"
                  level="H"
                  marginSize={3}
                />
              </div>

              <div className="space-y-1">
                <p className="font-mono text-xl font-extrabold text-[#272F31]">
                  {meta.passportCode}
                </p>
                {meta.materialSubtype && (
                  <p className="text-sm font-semibold text-slate-700">
                    {meta.materialSubtype}
                    {meta.purityGrade ? ` · ${meta.purityGrade}` : ''}
                  </p>
                )}
                {(meta.weightKg || meta.availableTons) && (
                  <p className="text-xs font-mono text-emerald-700 font-bold">
                    {meta.weightKg
                      ? `${meta.weightKg.toLocaleString()} kg (${(meta.weightKg / 1000).toFixed(2)} t)`
                      : `${meta.availableTons?.toFixed(2)} t`}
                    {meta.hubName ? ` · ${meta.hubName}` : ''}
                  </p>
                )}
              </div>

              <p className="text-xs text-slate-500 max-w-xs">
                Point the 3PL Driver or Field Worker camera directly at this high-contrast QR code to verify Stage 6 chain-of-custody handoff.
              </p>

              <div className="no-print w-full grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleDownloadPngTag}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Bale Tag</span>
                </button>
                <button
                  type="button"
                  onClick={handlePrintTag}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-[#272F31] text-xs font-bold"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Tag</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  CameraOff,
  ImageUp,
  X,
  CheckCircle2,
  AlertTriangle,
  ScanLine,
} from 'lucide-react';
import { extractPassportCodeFromScan } from '../lib/passport-qr.ts';
import type { Lang } from '../shared/i18n.ts';

interface PassportQRScannerProps {
  open: boolean;
  lang: Lang;
  expectedPassportCode?: string;
  onDetected: (passportCode: string, rawPayload: string) => void;
  onClose: () => void;
}

export const PassportQRScanner: React.FC<PassportQRScannerProps> = ({
  open,
  lang,
  expectedPassportCode,
  onDetected,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const handleDecodedPayload = (rawData: string) => {
    const extracted = extractPassportCodeFromScan(rawData);
    if (!extracted) {
      setScanError(
        lang === 'ar'
          ? 'تم مسح الرمز لكنه لا يحتوي على رقم جواز أورو صالح.'
          : 'QR code detected, but it does not contain a valid OURO Digital Waste Passport ID.'
      );
      return;
    }

    if (
      expectedPassportCode &&
      extracted.toUpperCase() !== expectedPassportCode.trim().toUpperCase()
    ) {
      setScanError(
        lang === 'ar'
          ? `عدم تطابق: تم مسح ${extracted} بدلاً من الجواز المتوقع ${expectedPassportCode}.`
          : `Passport mismatch: Scanned ${extracted}, expected ${expectedPassportCode}.`
      );
      return;
    }

    setScanError(null);
    setLastScanned(extracted);
    stopCamera();
    onDetected(extracted, rawData);
  };

  const startCamera = async () => {
    setCameraError(null);
    setScanError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        lang === 'ar'
          ? 'الكاميرا غير مدعومة في هذا المتصفح. يمكنك رفع صورة رمز QR أدناه.'
          : 'Live camera access is unavailable in this browser context. You can upload a QR Bale Tag image below.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);

      let lastFrameTime = 0;
      const scanLoop = (timestamp: number) => {
        if (!streamRef.current || !videoRef.current || !canvasRef.current) return;

        // Decode at ~8 fps for low power consumption on field mobile devices
        if (timestamp - lastFrameTime > 125 && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
          lastFrameTime = timestamp;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          const width = video.videoWidth;
          const height = video.videoHeight;

          if (width > 0 && height > 0) {
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(video, 0, 0, width, height);
              const imageData = ctx.getImageData(0, 0, width, height);
              const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert',
              });
              if (decoded && decoded.data) {
                handleDecodedPayload(decoded.data);
                return;
              }
            }
          }
        }
        rafRef.current = requestAnimationFrame(scanLoop);
      };

      rafRef.current = requestAnimationFrame(scanLoop);
    } catch (err: any) {
      setCameraError(
        err?.name === 'NotAllowedError'
          ? lang === 'ar'
            ? 'تم رفض إذن الكاميرا. اسمح بالوصول أو قم برفع صورة رمز QR.'
            : 'Camera permission denied. Allow camera access or scan a QR Bale Tag image below.'
          : lang === 'ar'
          ? 'تعذر تشغيل الكاميرا. يمكنك رفع صورة رمز QR أدناه.'
          : 'Could not initialize camera. You can still scan any OURO QR Bale Tag image below.'
      );
      stopCamera();
    }
  };

  useEffect(() => {
    if (open) {
      setLastScanned(null);
      setScanError(null);
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Decodes a QR code directly from an uploaded PNG/JPG Bale Tag or photo.
   */
  const handleImageUploadScan = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (decoded && decoded.data) {
          handleDecodedPayload(decoded.data);
        } else {
          setScanError(
            lang === 'ar'
              ? 'لم يتم العثور على رمز QR واضح في هذه الصورة.'
              : 'No scannable QR code was detected in that image. Try a clearer photo or the downloaded Bale Tag PNG.'
          );
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[#272F31]/80 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label="On-Site Passport QR Scanner"
    >
      <div className="w-full max-w-md rounded-2xl bg-white text-[#272F31] shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#272F31] text-white px-5 py-3.5">
          <div className="flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold">
                {lang === 'ar' ? 'ماسح رمز QR لجواز المخلفات' : 'On-Site Passport QR Scanner'}
              </h3>
              {expectedPassportCode && (
                <p className="text-[11px] font-mono text-emerald-300">
                  Target: {expectedPassportCode}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close scanner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Camera Viewfinder */}
          <div className="relative rounded-xl overflow-hidden bg-[#08172C] aspect-[4/3] flex items-center justify-center border border-slate-200">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {cameraActive && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-48 rounded-2xl border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(15,37,68,0.45)]" />
              </div>
            )}

            {!cameraActive && (
              <div className="p-6 text-center text-slate-300 space-y-2">
                <CameraOff className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-xs leading-relaxed">
                  {cameraError ||
                    (lang === 'ar' ? 'جاري تشغيل الكاميرا...' : 'Initializing rear camera viewfinder...')}
                </p>
                {cameraError && (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{lang === 'ar' ? 'إعادة المحاولة' : 'Retry Camera'}</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {scanError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{scanError}</span>
            </div>
          )}

          {lastScanned && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span className="font-mono font-bold">Verified: {lastScanned}</span>
            </div>
          )}

          {/* Upload QR Image / Bale Tag PNG Fallback */}
          <div className="space-y-2">
            <label className="w-full min-h-[46px] flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-[#F8FAFC] hover:bg-slate-100 px-4 py-2.5 cursor-pointer text-xs font-bold text-[#272F31] transition-colors">
              <ImageUp className="w-4 h-4 text-emerald-600" />
              <span>
                {lang === 'ar'
                  ? 'أو امسح صورة ملصق QR محفوظة (PNG / JPG)'
                  : 'Or Scan from QR Bale Tag Image (PNG / JPG)'}
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUploadScan}
                className="hidden"
              />
            </label>
            <p className="text-[11px] text-center text-slate-500">
              {lang === 'ar'
                ? 'يدعم المسح المباشر بالكاميرا أو قراءة ملصقات أورو الرقمية.'
                : 'Works with live rear camera or any downloaded OURO Passport Bale Tag.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

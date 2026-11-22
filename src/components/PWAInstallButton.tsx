import React, { useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';
import { usePWAInstall, useOnlineStatus } from '../hooks/usePWA.ts';

export const PWAInstallButton: React.FC<{ variant?: 'light' | 'dark' }> = ({ variant = 'light' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
          variant === 'dark'
            ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/30 hover:bg-emerald-500/25'
            : 'bg-slate-100 text-[#272F31] border border-slate-200 hover:bg-slate-200'
        }`}
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install PWA</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
            variant === 'dark'
              ? 'bg-white/10 text-white border border-white/20 hover:bg-white/15'
              : 'bg-slate-100 text-[#272F31] border border-slate-200 hover:bg-slate-200'
          }`}
        >
          <Download className="w-3.5 h-3.5" />
          <span>Install App</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#272F31]/60 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-6 text-[#272F31] shadow-xl border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold">Install OURO on iOS</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="space-y-2 text-sm text-slate-600 list-decimal list-inside">
                <li>Tap the <strong>Share</strong> icon in Safari.</li>
                <li>Scroll down and choose <strong>Add to Home Screen</strong>.</li>
                <li>Launch OURO directly in field standalone mode.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg bg-[#272F31] py-2.5 text-sm font-semibold text-white hover:bg-[#333D40]"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg no-print">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Offline Mode — Field submissions will queue and sync automatically when reconnected.</span>
    </div>
  );
};

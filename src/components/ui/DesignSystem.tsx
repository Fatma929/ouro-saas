import React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { LIFECYCLE_STATUS_LABELS, type LifecycleStatus } from '../../shared/constants.ts';
import type { Lang } from '../../shared/i18n.ts';

interface LifecycleBadgeProps {
  status: string;
  lang?: Lang;
}

/**
 * Strictly distinguishes the 3 core OURO circular-economy states:
 * - LISTED (neutral slate)
 * - DELIVERED (brushed antique gold — delivered to facility, NOT yet recycled)
 * - RECYCLED (pine teal — verified Stage 7 recycling outcome)
 */
export const LifecycleBadge: React.FC<LifecycleBadgeProps> = ({ status, lang = 'en' }) => {
  const normalized = (status || 'LISTED').toUpperCase() as LifecycleStatus;
  const labels = LIFECYCLE_STATUS_LABELS[normalized] || LIFECYCLE_STATUS_LABELS.LISTED;

  const styleMap: Record<LifecycleStatus, string> = {
    LISTED: 'border-slate-300 bg-slate-100 text-slate-700',
    DELIVERED: 'border-amber-300 bg-amber-50 text-amber-800',
    RECYCLED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-bold tracking-wide uppercase whitespace-nowrap ${
        styleMap[normalized] || styleMap.LISTED
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          normalized === 'RECYCLED'
            ? 'bg-emerald-600'
            : normalized === 'DELIVERED'
            ? 'bg-amber-600'
            : 'bg-slate-500'
        }`}
      />
      {labels[lang]}
    </span>
  );
};

interface KpiTileProps {
  label: string;
  value: string | number;
  sublabel?: string;
  tone?: 'default' | 'teal' | 'gold' | 'alert';
}

export const KpiTile: React.FC<KpiTileProps> = ({ label, value, sublabel, tone = 'default' }) => {
  const borderClass =
    tone === 'teal'
      ? 'border-emerald-200 bg-emerald-50/40'
      : tone === 'gold'
      ? 'border-amber-200 bg-amber-50/40'
      : tone === 'alert'
      ? 'border-red-200 bg-red-50/40'
      : 'border-slate-200 bg-white';

  const valueClass =
    tone === 'teal'
      ? 'text-emerald-800'
      : tone === 'gold'
      ? 'text-amber-800'
      : tone === 'alert'
      ? 'text-red-700'
      : 'text-[#272F31]';

  return (
    <div className={`rounded-xl border p-4 shadow-xs ${borderClass}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`text-2xl font-extrabold font-mono tabular-nums mt-1 ${valueClass}`}>{value}</p>
      {sublabel && <p className="text-[11px] text-slate-500 mt-1">{sublabel}</p>}
    </div>
  );
};

interface StatusNoticeProps {
  variant: 'success' | 'error' | 'warning' | 'info';
  children: React.ReactNode;
}

export const StatusNotice: React.FC<StatusNoticeProps> = ({ variant, children }) => {
  const styles = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    error: 'border-red-200 bg-red-50 text-red-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-slate-200 bg-slate-50 text-slate-700',
  };
  const Icon =
    variant === 'success'
      ? CheckCircle2
      : variant === 'error'
      ? XCircle
      : variant === 'warning'
      ? AlertTriangle
      : Info;

  return (
    <div className={`rounded-xl border px-4 py-3 text-xs sm:text-sm flex items-start gap-2.5 ${styles[variant]}`}>
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="flex-1">{children}</div>
    </div>
  );
};

export const EmptyState: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center">
    <p className="text-sm font-bold text-[#272F31]">{title}</p>
    <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{description}</p>
  </div>
);

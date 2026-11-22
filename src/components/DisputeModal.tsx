import React, { useState } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { DISPUTE_CATEGORIES } from '../shared/constants.ts';
import type { Lang } from '../shared/i18n.ts';

interface DisputeModalProps {
  open: boolean;
  lang: Lang;
  reservationId?: number | null;
  passportId?: number | null;
  referenceLabel?: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

export const DisputeModal: React.FC<DisputeModalProps> = ({
  open,
  lang,
  reservationId,
  passportId,
  referenceLabel,
  onClose,
  onSubmitted,
}) => {
  const [category, setCategory] = useState('weight_discrepancy');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/disputes', {
        method: 'POST',
        body: JSON.stringify({
          reservationId: reservationId ?? null,
          passportId: passportId ?? null,
          category,
          subject,
          description,
        }),
      });
      setSubject('');
      setDescription('');
      onSubmitted?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Could not submit dispute.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#272F31]/65 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between bg-[#272F31] px-5 py-4 text-white">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold">
              {lang === 'ar' ? 'فتح بلاغ أو نزاع تشغيلي' : 'Report Operational Issue / Dispute'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {referenceLabel && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
              {lang === 'ar' ? 'المرجع المرتبط:' : 'Linked Reference:'}{' '}
              <span className="font-mono font-bold text-[#272F31]">{referenceLabel}</span>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {lang === 'ar' ? 'تصنيف البلاغ' : 'Issue Category'}
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:border-emerald-600"
            >
              {DISPUTE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c[lang]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {lang === 'ar' ? 'عنوان المشكلة' : 'Subject'}
            </label>
            <input
              type="text"
              required
              minLength={4}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={
                lang === 'ar'
                  ? 'مثال: فرق وزن بين الميزان والاستلام'
                  : 'e.g., Weighbridge intake weight discrepancy'
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {lang === 'ar' ? 'التفاصيل والأدلة' : 'Detailed Description'}
            </label>
            <textarea
              required
              minLength={10}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                lang === 'ar'
                  ? 'اشرح الواقعة بدقة ليتمكن فريق إدارة أورو من مراجعتها وحلها...'
                  : 'Describe the discrepancy, weights, or logistics issue for OURO platform governance review...'
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#272F31] hover:bg-[#333D40] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{lang === 'ar' ? 'إرسال للإدارة' : 'Submit Dispute'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Info } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { Lang } from '../shared/i18n.ts';

interface NotificationBellProps {
  lang: Lang;
  onInspectPassport: (code: string) => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ lang, onInspectPassport }) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [emailStatus, setEmailStatus] = useState<{ configured: boolean; note: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadNotifications = async () => {
    try {
      const res = await apiFetch('/api/notifications');
      setItems(res.notifications || []);
      setUnreadCount(res.unreadCount || 0);
      setEmailStatus(res.emailProviderStatus || null);
    } catch {
      // ignore transient polling failure
    }
  };

  useEffect(() => {
    loadNotifications();
    const timer = setInterval(loadNotifications, 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const handleMarkRead = async (n: any) => {
    if (!n.isRead) {
      await apiFetch(`/api/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    if (n.entityType === 'passport' && n.entityId) {
      setOpen(false);
      onInspectPassport(n.entityId);
    }
  };

  const handleReadAll = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
    setItems((prev) => prev.map((x) => ({ ...x, isRead: true })));
    setUnreadCount(0);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) loadNotifications();
        }}
        className="relative inline-flex items-center justify-center rounded-lg bg-white/8 hover:bg-white/15 w-9 h-9 text-white transition-colors"
        aria-label="Notifications"
        title={lang === 'ar' ? 'الإشعارات' : 'Notifications'}
      >
        <Bell className="w-4 h-4 text-[#C4A87E]" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center px-1 border border-[#272F31]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 mt-2 w-80 sm:w-96 rounded-xl bg-white text-[#272F31] shadow-2xl border border-slate-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-[#272F31] text-white">
            <span className="text-xs font-bold">
              {lang === 'ar' ? 'مركز الإشعارات' : 'Notifications'} ({unreadCount})
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleReadAll}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#C4A87E] hover:text-white"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>{lang === 'ar' ? 'تحديد الكل كمقروء' : 'Mark all read'}</span>
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {items.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                {lang === 'ar' ? 'لا توجد إشعارات حالياً.' : 'No notifications yet.'}
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleMarkRead(n)}
                  className={`w-full text-start px-4 py-3 hover:bg-slate-50 transition-colors ${
                    n.isRead ? 'opacity-70' : 'bg-emerald-50/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-bold text-[#272F31]">
                      {lang === 'ar' ? n.titleAr : n.titleEn}
                    </p>
                    {!n.isRead && <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0 mt-1" />}
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 leading-snug">
                    {lang === 'ar' ? n.messageAr : n.messageEn}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 mt-1">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </button>
              ))
            )}
          </div>

          {emailStatus && (
            <div className="px-3.5 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
              <span>{emailStatus.note}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

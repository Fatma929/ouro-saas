import React, { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { Globe, LogOut, Search, ScanLine } from 'lucide-react';
import { auth } from './lib/firebase.ts';
import { apiFetch, setAuthToken } from './lib/api.ts';
import { extractPassportCodeFromScan } from './lib/passport-qr.ts';
import { GoogleMapsWrapper } from './components/maps/GoogleMapsProvider.tsx';
import { OuroLogo } from './components/OuroLogo.tsx';
import { PortalAuth } from './components/PortalAuth.tsx';
import { HubWorkerWorkspace } from './components/HubWorkerWorkspace.tsx';
import { FactoryMarketplace } from './components/FactoryMarketplace.tsx';
import { Driver3plWorkspace } from './components/Driver3plWorkspace.tsx';
import { AdminCommandDashboard } from './components/AdminCommandDashboard.tsx';
import { PassportModal } from './components/PassportModal.tsx';
import { PassportQRScanner } from './components/PassportQRScanner.tsx';
import { EsgCertificateModal } from './components/EsgCertificateModal.tsx';
import { NotificationBell } from './components/NotificationBell.tsx';
import { PWAInstallButton, OfflineIndicator } from './components/PWAInstallButton.tsx';
import { TRANSLATIONS, type Lang } from './shared/i18n.ts';
import type { UserRole } from './shared/constants.ts';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [lang, setLang] = useState<Lang>('en');
  const [activeWorkspace, setActiveWorkspace] = useState<UserRole>('platform_admin');
  const [inspectPassportCode, setInspectPassportCode] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const param = new URLSearchParams(window.location.search).get('passport');
    return param ? extractPassportCodeFromScan(param) : null;
  });
  const [passportSearch, setPassportSearch] = useState('');
  const [globalScannerOpen, setGlobalScannerOpen] = useState(false);
  const [showEsgModal, setShowEsgModal] = useState(false);
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);

  // Sync HTML direction & lang for full English / Arabic (RTL) experience
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  // Google Maps Platform Demo Key Quota Banner Listener (persists across child unmounts)
  useEffect(() => {
    const onQuotaExceeded = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  const handleToggleLang = () => {
    const next: Lang = lang === 'en' ? 'ar' : 'en';
    setLang(next);
    if (user) {
      apiFetch('/api/auth/language', {
        method: 'PATCH',
        body: JSON.stringify({ language: next }),
      }).catch(() => {});
    }
  };

  const handleAuthenticated = (authenticatedUser: any, token: string) => {
    setAuthToken(token);
    setUser(authenticatedUser);
    setActiveWorkspace(authenticatedUser.role as UserRole);
    if (authenticatedUser.language === 'ar' || authenticatedUser.language === 'en') {
      setLang(authenticatedUser.language);
    }
  };

  const handleSignOut = async () => {
    setAuthToken(null);
    setUser(null);
    setInspectPassportCode(null);
    setShowEsgModal(false);
    try {
      await signOut(auth);
    } catch {
      // ignore if user signed in via role credentials
    }
  };

  const handlePassportLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = extractPassportCodeFromScan(passportSearch) || passportSearch.trim();
    if (cleaned) {
      setInspectPassportCode(cleaned.toUpperCase());
      setPassportSearch('');
    }
  };

  const t = TRANSLATIONS[lang];

  return (
    <GoogleMapsWrapper lang={lang}>
      {/* Required Google Maps Demo Key Quota Banner (Case A — Non-blocking Sticky Top Bar) */}
      {gmpQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm no-print">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {!user ? (
        <PortalAuth
          lang={lang}
          onToggleLang={handleToggleLang}
          onAuthenticated={handleAuthenticated}
        />
      ) : (
        <div className="min-h-screen flex flex-col bg-[#F6F7F7] text-[#272F31]">
          {/* Clean 3-Zone Top Navigation Bar */}
          <header className="no-print sticky top-0 z-30 bg-[#272F31] text-[#FBFCFD] border-b border-[#A88B64]/25">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
              {/* Zone 1: Brand Wordmark */}
              <div className="shrink-0">
                <OuroLogo variant="light" size="sm" />
              </div>

              {/* Zone 2: Navigation (Admin can inspect all workspaces; other roles strictly isolated) */}
              <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#BCC2C3]">
                {user.role === 'platform_admin' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveWorkspace('platform_admin')}
                      className={`whitespace-nowrap shrink-0 transition-colors ${
                        activeWorkspace === 'platform_admin'
                          ? 'text-[#C4A87E] font-semibold'
                          : 'hover:text-white'
                      }`}
                    >
                      {t.roles.platform_admin}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveWorkspace('generator_ops')}
                      className={`whitespace-nowrap shrink-0 transition-colors ${
                        activeWorkspace === 'generator_ops'
                          ? 'text-[#C4A87E] font-semibold'
                          : 'hover:text-white'
                      }`}
                    >
                      {t.roles.generator_ops}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveWorkspace('factory_procurement')}
                      className={`whitespace-nowrap shrink-0 transition-colors ${
                        activeWorkspace === 'factory_procurement'
                          ? 'text-[#C4A87E] font-semibold'
                          : 'hover:text-white'
                      }`}
                    >
                      {t.roles.factory_procurement}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveWorkspace('driver_3pl')}
                      className={`whitespace-nowrap shrink-0 transition-colors ${
                        activeWorkspace === 'driver_3pl'
                          ? 'text-[#C4A87E] font-semibold'
                          : 'hover:text-white'
                      }`}
                    >
                      {t.roles.driver_3pl}
                    </button>
                  </>
                ) : (
                  <span className="text-[#E6EBEB] font-semibold whitespace-nowrap">
                    {t.roles[user.role as UserRole]} · {user.fullName}
                  </span>
                )}
              </nav>

              {/* Zone 3: Quick Passport Lookup + Notifications + Language + Sign Out */}
              <div className="flex items-center gap-2 shrink-0">
                <form onSubmit={handlePassportLookup} className="hidden lg:flex items-center relative">
                  <Search className="w-3.5 h-3.5 text-[#9EA3A4] absolute left-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={passportSearch}
                    onChange={(e) => setPassportSearch(e.target.value)}
                    placeholder="OURO-PAS-..."
                    className="w-36 rounded-lg bg-white/8 border border-white/15 pl-8 pr-2.5 py-1.5 text-xs font-mono text-white placeholder-[#9EA3A4] focus:outline-none focus:border-[#A88B64]"
                  />
                </form>

                <button
                  type="button"
                  onClick={() => setGlobalScannerOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/8 hover:bg-white/15 px-2.5 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap min-h-[36px]"
                  title="Scan Digital Waste Passport QR"
                >
                  <ScanLine className="w-3.5 h-3.5 text-[#C4A87E]" />
                  <span className="hidden sm:inline">{lang === 'ar' ? 'مسح QR' : 'Scan QR'}</span>
                </button>

                <NotificationBell lang={lang} onInspectPassport={setInspectPassportCode} />

                <PWAInstallButton variant="dark" />

                <button
                  type="button"
                  onClick={handleToggleLang}
                  className="inline-flex items-center gap-1 rounded-lg bg-white/8 hover:bg-white/15 px-2.5 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap min-h-[36px]"
                  title="Switch English / Arabic"
                >
                  <Globe className="w-3.5 h-3.5 text-[#68A899]" />
                  <span>{lang === 'en' ? 'AR' : 'EN'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#3D7568] hover:bg-[#488577] px-3 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap min-h-[36px]"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{t.auth.signOut}</span>
                </button>
              </div>
            </div>
          </header>

          {/* Role-Protected Main Workspace Viewport */}
          <main className="flex-1">
            {activeWorkspace === 'generator_ops' && (
              <HubWorkerWorkspace
                user={user}
                lang={lang}
                onInspectPassport={setInspectPassportCode}
                onOpenEsgCertificate={() => setShowEsgModal(true)}
              />
            )}
            {activeWorkspace === 'factory_procurement' && (
              <FactoryMarketplace
                user={user}
                lang={lang}
                onInspectPassport={setInspectPassportCode}
                onOpenEsgCertificate={() => setShowEsgModal(true)}
              />
            )}
            {activeWorkspace === 'driver_3pl' && (
              <Driver3plWorkspace
                user={user}
                lang={lang}
                onInspectPassport={setInspectPassportCode}
              />
            )}
            {activeWorkspace === 'platform_admin' && (
              <AdminCommandDashboard
                lang={lang}
                onInspectPassport={setInspectPassportCode}
                onOpenEsgCertificate={() => setShowEsgModal(true)}
              />
            )}
          </main>

          {/* Digital Waste Passport Modal (Accessible across all 4 roles) */}
          <PassportModal
            passportCodeOrId={inspectPassportCode}
            lang={lang}
            onClose={() => {
              setInspectPassportCode(null);
              if (window.location.search.includes('passport=')) {
                const url = new URL(window.location.href);
                url.searchParams.delete('passport');
                window.history.replaceState({}, '', url.pathname + url.search);
              }
            }}
          />

          {/* Quick Global On-Site Passport QR Scanner */}
          <PassportQRScanner
            open={globalScannerOpen}
            lang={lang}
            onDetected={(code) => {
              setGlobalScannerOpen(false);
              setInspectPassportCode(code);
            }}
            onClose={() => setGlobalScannerOpen(false)}
          />

          {/* Auditable Printable ESG Certificate Modal */}
          <EsgCertificateModal
            open={showEsgModal}
            onClose={() => setShowEsgModal(false)}
          />
        </div>
      )}

      <OfflineIndicator />
    </GoogleMapsWrapper>
  );
}

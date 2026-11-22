import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import {
  Scale,
  Factory,
  Truck,
  ShieldCheck,
  Globe,
  Upload,
  Loader2,
  ArrowRight,
  Lock,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiFetch, setAuthToken } from '../lib/api.ts';
import { OuroLogo } from './OuroLogo.tsx';
import { PWAInstallButton } from './PWAInstallButton.tsx';
import {
  GOVERNORATES,
  FACILITY_TYPE_LABELS,
  HUB_FACILITY_IMAGE,
  MATERIAL_METADATA,
  type UserRole,
  type FacilityType,
  type MaterialCategory,
} from '../shared/constants.ts';
import { TRANSLATIONS, type Lang } from '../shared/i18n.ts';

interface PortalAuthProps {
  lang: Lang;
  onToggleLang: () => void;
  onAuthenticated: (user: any, token: string) => void;
}

const IS_NON_PROD = import.meta.env.VITE_APP_ENV !== 'production';

const STAGING_ACCOUNTS: Record<
  UserRole,
  Array<{ label: string; identifier: string; password: string }>
> = {
  generator_ops: [
    {
      label: 'Smart Village Corporate Park (Company)',
      identifier: 'GEN-OPS-001',
      password: 'OuroDemo#2026',
    },
  ],
  factory_procurement: [
    {
      label: 'Nile Kraft Mills (KYC Approved)',
      identifier: 'procurement@nilekraft.eg',
      password: 'OuroDemo#2026',
    },
    {
      label: 'Delta Polymer (KYC Pending)',
      identifier: 'kyc-pending@deltapolymer.eg',
      password: 'OuroDemo#2026',
    },
  ],
  driver_3pl: [
    { label: 'NileGreen 3PL Driver', identifier: 'DRV-3PL-001', password: 'OuroDemo#2026' },
  ],
  platform_admin: [
    { label: 'OURO Platform Admin', identifier: 'admin@ouro.eco', password: 'OuroDemo#2026' },
  ],
};

export const PortalAuth: React.FC<PortalAuthProps> = ({
  lang,
  onToggleLang,
  onAuthenticated,
}) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>('factory_procurement');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  // Login state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // Waste Generator Facility registration state
  const [genFacilityName, setGenFacilityName] = useState('');
  const [genFacilityType, setGenFacilityType] = useState<FacilityType>('factory');
  const [genCommercialRegNo, setGenCommercialRegNo] = useState('');
  const [genGovernorate, setGenGovernorate] = useState<string>('Greater Cairo');
  const [genAddress, setGenAddress] = useState('');
  const [genContactPerson, setGenContactPerson] = useState('');
  const [genPhone, setGenPhone] = useState('');
  const [genEmail, setGenEmail] = useState('');
  const [genPassword, setGenPassword] = useState('');

  // Factory onboarding registration state
  const [regFactoryName, setRegFactoryName] = useState('');
  const [regIndustrialZone, setRegIndustrialZone] = useState('');
  const [regGovernorate, setRegGovernorate] = useState<string>('6th of October');
  const [regTaxId, setRegTaxId] = useState('');
  const [regCommercialRegNo, setRegCommercialRegNo] = useState('');
  const [regContactPerson, setRegContactPerson] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regCategories, setRegCategories] = useState<MaterialCategory[]>([
    'paper_cardboard',
    'plastics',
  ]);
  const [kycFile, setKycFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = TRANSLATIONS[lang];

  const roleTabs: Array<{ id: UserRole; label: string; icon: React.ReactNode }> = [
    { id: 'generator_ops', label: t.roles.generator_ops, icon: <Scale className="w-4 h-4" /> },
    {
      id: 'factory_procurement',
      label: t.roles.factory_procurement,
      icon: <Factory className="w-4 h-4" />,
    },
    { id: 'driver_3pl', label: t.roles.driver_3pl, icon: <Truck className="w-4 h-4" /> },
    {
      id: 'platform_admin',
      label: t.roles.platform_admin,
      icon: <ShieldCheck className="w-4 h-4" />,
    },
  ];

  const handleCredentialLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: any }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier: identifier.trim(),
          password,
          expectedRole: selectedRole,
        }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.token);
    } catch (err: any) {
      setError(err.message || 'Sign-in failed. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      setAuthToken(idToken);
      const res = await apiFetch<{ user: any }>('/api/auth/me');
      onAuthenticated(res.user, idToken);
    } catch (err: any) {
      setError(err.message || 'Google Sign-In was cancelled or failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleFactoryRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('factoryName', regFactoryName);
      formData.append('industrialZone', regIndustrialZone);
      formData.append('governorate', regGovernorate);
      formData.append('taxId', regTaxId);
      formData.append('commercialRegNo', regCommercialRegNo);
      formData.append('contactPerson', regContactPerson);
      formData.append('phone', regPhone);
      formData.append('email', regEmail);
      formData.append('password', regPassword);
      formData.append('preferredCategories', JSON.stringify(regCategories));
      if (kycFile) {
        formData.append('kycDocument', kycFile);
      }

      const res = await apiFetch<{ token: string; user: any }>('/api/auth/register-factory', {
        method: 'POST',
        body: formData,
      });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.token);
    } catch (err: any) {
      setError(err.message || 'Factory onboarding registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratorRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: any }>('/api/auth/register-generator', {
        method: 'POST',
        body: JSON.stringify({
          facilityName: genFacilityName,
          facilityType: genFacilityType,
          commercialRegNo: genCommercialRegNo,
          governorate: genGovernorate,
          address: genAddress,
          contactPerson: genContactPerson,
          phone: genPhone,
          email: genEmail,
          password: genPassword,
        }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.token);
    } catch (err: any) {
      setError(err.message || 'Waste Generator facility registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (cat: MaterialCategory) => {
    setRegCategories((prev) =>
      prev.includes(cat) ? (prev.length > 1 ? prev.filter((c) => c !== cat) : prev) : [...prev, cat]
    );
  };

  const identifierLabel =
    selectedRole === 'generator_ops'
      ? t.auth.identifierGenerator
      : selectedRole === 'factory_procurement'
      ? t.auth.identifierFactory
      : selectedRole === 'driver_3pl'
      ? t.auth.identifierDriver
      : t.auth.identifierAdmin;

  return (
    <div
      className="min-h-screen w-full flex flex-col justify-between bg-[#272F31] text-[#FBFCFD]"
      style={{
        backgroundImage:
          'radial-gradient(circle at 14% 18%, rgba(61, 117, 104, 0.22) 0%, transparent 45%), radial-gradient(circle at 86% 84%, rgba(168, 139, 100, 0.14) 0%, transparent 45%)',
      }}
    >
      {/* Top Bar */}
      <header className="w-full max-w-7xl mx-auto px-6 py-5 flex items-center justify-between gap-4 border-b border-white/8">
        <OuroLogo variant="light" size="md" />
        <div className="flex items-center gap-2.5">
          <PWAInstallButton variant="dark" />
          <button
            type="button"
            onClick={onToggleLang}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1D2426] border border-[#A88B64]/35 text-[#FBFCFD] px-3.5 py-2 text-xs font-semibold hover:bg-[#333D40] transition-colors min-h-[38px] whitespace-nowrap"
          >
            <Globe className="w-3.5 h-3.5 text-[#C4A87E]" />
            <span>{lang === 'en' ? 'العربية (AR)' : 'English (EN)'}</span>
          </button>
        </div>
      </header>

      {/* Main Split Portal Layout */}
      <main className="w-full max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch flex-1">
        {/* Left Brand Context Column */}
        <section className="lg:col-span-5 flex flex-col justify-between gap-6 py-1">
          <div className="space-y-5">
            {/* Official OURO Brand Emblem Showcase on Native #272F31 Canvas */}
            <div className="flex items-center gap-5 pb-4 border-b border-white/10">
              <OuroLogo
                layout="stacked"
                size="sm"
                className="ring-1 ring-[#A88B64]/30 shadow-lg"
              />
              <div className="space-y-1.5">
                <p className="text-xs font-semibold tracking-wide text-[#C4A87E]">
                  {t.portalSubtitle}
                </p>
                <h1 className="text-2xl xl:text-3xl font-extrabold text-[#FBFCFD] leading-[1.15] [text-wrap:balance]">
                  {t.tagline}
                </h1>
              </div>
            </div>

            <p className="text-sm sm:text-base text-[#CBD2D3] leading-relaxed max-w-lg">
              {lang === 'en'
                ? 'Strictly B2B circular economy platform connecting Factories, Corporate Companies, Educational & Service Institutions, Hotels, and Commercial Facilities directly to verified industrial recycling factories via 7-stage Digital Waste Passports and certified 3PL transport.'
                : 'منصة B2B متكاملة للاقتصاد الدائري تربط مولدي المخلفات (المصانع، الشركات، المؤسسات التعليمية والخدمية، الفنادق، والمنشآت التجارية) في مصر والشرق الأوسط مباشرة بمصانع إعادة التدوير المعتمدة عبر جواز المخلفات الرقمي من 7 مراحل وشركات النقل البيئي المرخصة.'}
            </p>

            {/* Concrete Operational Highlights (Unboxed Typography) */}
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10">
              <div>
                <p className="text-xs font-medium text-[#9EA3A4]">Chain of Custody</p>
                <p className="text-base font-extrabold font-mono text-[#FBFCFD]">7-Stage QR Passport</p>
              </div>
              <div>
                <p className="text-xs font-medium text-[#9EA3A4]">Logistics Model</p>
                <p className="text-base font-extrabold font-mono text-[#C4A87E]">Certified 3PL Only</p>
              </div>
              <div>
                <p className="text-xs font-medium text-[#9EA3A4]">Trade Corridors</p>
                <p className="text-sm font-semibold text-[#E2E7E7]">
                  Cairo · Giza · 6th Oct · 10th Ram · Sadat · Borg El Arab
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-[#9EA3A4]">ESG Accounting</p>
                <p className="text-sm font-semibold text-[#68A899]">EPA WARM v16 / IPCC</p>
              </div>
            </div>
          </div>

          {/* Architectural Facility Visual */}
          <div className="relative overflow-hidden rounded-2xl border border-[#A88B64]/25 shadow-xl aspect-[16/9] bg-[#1C2325]">
            <img
              src={HUB_FACILITY_IMAGE}
              alt="OURO B2B industrial waste generator sorting bay and certified 3PL loading dock"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#1C2325]/92 via-[#272F31]/30 to-transparent flex items-end p-5">
              <div className="text-white">
                <p className="text-xs font-semibold text-[#C4A87E]">
                  B2B Waste Generators & Industrial Corridors
                </p>
                <p className="text-sm font-medium text-[#FBFCFD]/95">
                  Factories · Companies · Institutions · Hotels · Commercial Centers
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Right High-Contrast Deep Charcoal Access Portal Card */}
        <section className="lg:col-span-7 flex flex-col justify-center">
          <div className="rounded-2xl bg-[#1C2325] text-[#FBFCFD] shadow-2xl border border-[#A88B64]/20 p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-white/10">
              <OuroLogo variant="light" size="md" showTagline tagline={t.tagline} />
              <div className="flex items-center gap-1.5 text-xs text-[#C4A87E] font-medium">
                <Lock className="w-3.5 h-3.5 text-[#68A899]" />
                <span>Role-Isolated RBAC Access</span>
              </div>
            </div>

            {/* 4 Role Selector Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-white/5 p-1.5 rounded-xl mt-5">
              {roleTabs.map((tab) => {
                const active = selectedRole === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setSelectedRole(tab.id);
                      setError(null);
                      setAuthMode('login');
                    }}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap min-h-[42px] ${
                      active
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {tab.icon}
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Login vs Registration Switcher for Waste Generators & Recycling Factories */}
            {(selectedRole === 'factory_procurement' || selectedRole === 'generator_ops') && (
              <div className="flex items-center gap-2 mt-5 border-b border-white/10 pb-3">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setError(null);
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    authMode === 'login'
                      ? 'bg-white text-[#272F31]'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {t.auth.loginTab}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('register');
                    setError(null);
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    authMode === 'register'
                      ? 'bg-white text-[#272F31]'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {selectedRole === 'factory_procurement'
                    ? `${t.auth.registerFactory} (KYC Onboarding)`
                    : `${t.auth.registerGenerator} (B2B Onboarding)`}
                </button>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-xs font-medium text-red-100">
                {error}
              </div>
            )}

            {/* Standard Role Login Form */}
            {!(
              (selectedRole === 'factory_procurement' || selectedRole === 'generator_ops') &&
              authMode === 'register'
            ) ? (
              <form onSubmit={handleCredentialLogin} className="mt-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    {identifierLabel}
                  </label>
                  <input
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={
                      selectedRole === 'generator_ops'
                        ? 'GEN-OPS-001 or ops@smartvillage.eg'
                        : selectedRole === 'driver_3pl'
                        ? 'DRV-3PL-001 or +20 100...'
                        : selectedRole === 'platform_admin'
                        ? 'admin@ouro.eco'
                        : 'procurement@nilekraft.eg'
                    }
                    className="w-full rounded-xl bg-white/10 border border-white/15 px-4 py-3 text-sm text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    {t.auth.password}
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full rounded-xl bg-white/10 border border-white/15 px-4 py-3 text-sm text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>{t.auth.signIn}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {/* Google Sign-In via Firebase Auth */}
                <div className="relative flex items-center justify-center py-1">
                  <span className="h-px w-full bg-white/10" />
                  <span className="px-3 text-[11px] text-slate-400 whitespace-nowrap">or</span>
                  <span className="h-px w-full bg-white/10" />
                </div>

                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2.5 rounded-xl bg-white text-[#272F31] hover:bg-slate-100 font-semibold text-sm transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.87-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.3v3.09A12 12 0 0 0 12 24Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.29 14.3a7.21 7.21 0 0 1 0-4.6V6.61H1.3a12 12 0 0 0 0 10.78l3.99-3.09Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.3 6.61l3.99 3.09C6.23 6.86 8.88 4.75 12 4.75Z"
                    />
                  </svg>
                  <span>{t.auth.googleSignIn}</span>
                </button>

                {/* Strictly Environment-Gated Staging Quick-Fill Helper */}
                {IS_NON_PROD && (
                  <div className="mt-5 pt-4 border-t border-white/10">
                    <p className="text-[11px] font-semibold text-emerald-300/90 mb-2">
                      {t.auth.stagingQuickAccess}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {STAGING_ACCOUNTS[selectedRole].map((acct) => (
                        <button
                          key={acct.identifier}
                          type="button"
                          onClick={() => {
                            setIdentifier(acct.identifier);
                            setPassword(acct.password);
                          }}
                          className="text-left rounded-lg bg-white/8 hover:bg-white/15 border border-white/10 px-3 py-2 text-xs text-slate-200 transition-colors"
                        >
                          <span className="block font-semibold text-white">{acct.label}</span>
                          <span className="font-mono text-[11px] text-emerald-300">
                            {acct.identifier}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </form>
            ) : selectedRole === 'generator_ops' ? (
              /* B2B & Institutional Waste Generator Facility Registration */
              <form onSubmit={handleGeneratorRegister} className="mt-4 space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Facility / Organization Name
                    </label>
                    <input
                      type="text"
                      required
                      value={genFacilityName}
                      onChange={(e) => setGenFacilityName(e.target.value)}
                      placeholder="e.g. Nile Valley Food Plant / Grand Hotel"
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Facility Type (B2B / Institutional)
                    </label>
                    <select
                      value={genFacilityType}
                      onChange={(e) => setGenFacilityType(e.target.value as FacilityType)}
                      className="w-full rounded-lg bg-[#272F31] border border-white/15 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                    >
                      {(Object.keys(FACILITY_TYPE_LABELS) as FacilityType[]).map((ft) => (
                        <option key={ft} value={ft}>
                          {FACILITY_TYPE_LABELS[ft][lang]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Commercial Registration No.
                    </label>
                    <input
                      type="text"
                      required
                      value={genCommercialRegNo}
                      onChange={(e) => setGenCommercialRegNo(e.target.value)}
                      placeholder="e.g. CR-CAI-604912"
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm font-mono text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Governorate
                    </label>
                    <select
                      value={genGovernorate}
                      onChange={(e) => setGenGovernorate(e.target.value)}
                      className="w-full rounded-lg bg-[#272F31] border border-white/15 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                    >
                      {GOVERNORATES.map((gov) => (
                        <option key={gov} value={gov}>
                          {gov}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Facility Street Address
                    </label>
                    <input
                      type="text"
                      required
                      value={genAddress}
                      onChange={(e) => setGenAddress(e.target.value)}
                      placeholder="District, Industrial Zone or Street, Egypt"
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Waste Coordinator / Contact Person
                    </label>
                    <input
                      type="text"
                      required
                      value={genContactPerson}
                      onChange={(e) => setGenContactPerson(e.target.value)}
                      placeholder="Full name"
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      required
                      value={genPhone}
                      onChange={(e) => setGenPhone(e.target.value)}
                      placeholder="+20 100 000 0000"
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm font-mono text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Work Email
                    </label>
                    <input
                      type="email"
                      required
                      value={genEmail}
                      onChange={(e) => setGenEmail(e.target.value)}
                      placeholder="sustainability@company.eg"
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Account Password (min. 8 chars)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={genPassword}
                      onChange={(e) => setGenPassword(e.target.value)}
                      placeholder="Create strong password"
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>Register Waste Generator Facility</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            ) : (
              /* Full Recycling Factory KYC Onboarding Registration */
              <form onSubmit={handleFactoryRegister} className="mt-4 space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Legal Factory Name
                    </label>
                    <input
                      type="text"
                      required
                      value={regFactoryName}
                      onChange={(e) => setRegFactoryName(e.target.value)}
                      placeholder="e.g. Cairo Eco-Fiber Mills S.A.E."
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Governorate
                    </label>
                    <select
                      value={regGovernorate}
                      onChange={(e) => setRegGovernorate(e.target.value)}
                      className="w-full rounded-lg bg-[#272F31] border border-white/15 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                    >
                      {GOVERNORATES.map((gov) => (
                        <option key={gov} value={gov}>
                          {gov}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Industrial Zone
                    </label>
                    <input
                      type="text"
                      required
                      value={regIndustrialZone}
                      onChange={(e) => setRegIndustrialZone(e.target.value)}
                      placeholder="e.g. 6th of October Zone 3"
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Egyptian Tax ID
                    </label>
                    <input
                      type="text"
                      required
                      value={regTaxId}
                      onChange={(e) => setRegTaxId(e.target.value)}
                      placeholder="e.g. 412-903-118"
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm font-mono text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Commercial Registration No.
                    </label>
                    <input
                      type="text"
                      required
                      value={regCommercialRegNo}
                      onChange={(e) => setRegCommercialRegNo(e.target.value)}
                      placeholder="e.g. CR-CAI-552910"
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm font-mono text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Procurement Contact Person
                    </label>
                    <input
                      type="text"
                      required
                      value={regContactPerson}
                      onChange={(e) => setRegContactPerson(e.target.value)}
                      placeholder="Full name"
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      required
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value)}
                      placeholder="+20 100 000 0000"
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm font-mono text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Work Email
                    </label>
                    <input
                      type="email"
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="buyer@factory.eg"
                      className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1">
                    Account Password (min. 8 characters)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Create strong password"
                    className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
                  />
                </div>

                {/* Preferred Recyclable Feedstocks */}
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                    Target Recyclable Materials (for Smart Matching)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(MATERIAL_METADATA) as MaterialCategory[]).map((cat) => {
                      const active = regCategories.includes(cat);
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => toggleCategory(cat)}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors text-left ${
                            active
                              ? 'bg-emerald-600/30 border-emerald-400 text-white'
                              : 'bg-white/5 border-white/15 text-slate-300 hover:bg-white/10'
                          }`}
                        >
                          <CheckCircle2
                            className={`w-3.5 h-3.5 shrink-0 ${
                              active ? 'text-emerald-400' : 'text-slate-500'
                            }`}
                          />
                          <span className="truncate">{MATERIAL_METADATA[cat][lang]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Legal KYC Document Upload */}
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1">
                    Upload Legal KYC Package (Commercial Registry / Tax Card — PDF, PNG, JPG, TXT)
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-white/30 bg-white/5 px-3.5 py-2.5 cursor-pointer hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-2 text-xs text-slate-200 truncate">
                      {kycFile ? (
                        <>
                          <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span className="truncate font-medium">{kycFile.name}</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span>Select Tax Card & Commercial Registry document</span>
                        </>
                      )}
                    </div>
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.txt"
                      className="hidden"
                      onChange={(e) => setKycFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>Submit Factory Onboarding for KYC Review</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </section>
      </main>

      <footer className="w-full max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#9EA3A4] border-t border-white/8">
        <span>© {new Date().getFullYear()} OURO Circular Economy Platform · Egypt & MENA</span>
        <span>Non-Hazardous Recyclables · Certified 3PL Chain of Custody</span>
      </footer>
    </div>
  );
};

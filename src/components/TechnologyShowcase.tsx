import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowRight,
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Factory,
  FileCheck2,
  GitBranch,
  Layers,
  Leaf,
  LineChart,
  Minus,
  Pause,
  Play,
  QrCode,
  RotateCcw,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { UserRole } from '../shared/constants.ts';
import type { Lang } from '../shared/i18n.ts';

export interface TechnologyShowcaseProps {
  lang?: Lang;
  onSelectPortalRole?: (role: UserRole, mode?: 'login' | 'register') => void;
}

type ViewLayoutMode = 'alternating' | 'spotlight';
type MaterialFilter = 'all' | 'paper' | 'plastics' | 'metals' | 'glass';
type AvailabilityFilter = 'all' | 'high' | 'moderate' | 'tight';
type ForecastHorizon = '30d' | '90d' | 'seasonal';
type ForecastStream = 'all' | 'paper' | 'plastics' | 'metals';
type DecisionMode = 'matching' | 'inventory' | 'sales';
type MatchPriority = 'purity' | 'proximity' | 'pickup';
type RunRateLevel = 'low' | 'standard' | 'peak';
type VerificationGate = 'listed' | 'delivered' | 'recycled';

interface SampleLot {
  code: string;
  titleEn: string;
  titleAr: string;
  corridorEn: string;
  corridorAr: string;
  generatorEn: string;
  generatorAr: string;
  carrierEn: string;
  carrierAr: string;
  hashPrefix: string;
}

const SAMPLE_PASSPORT_LOTS: SampleLot[] = [
  {
    code: 'PAS-SAMPLE-001',
    titleEn: 'Corrugated Cardboard (OCC) — Grade A',
    titleAr: 'كرتون مضلع (OCC) — درجة A',
    corridorEn: '6th of October Corridor',
    corridorAr: 'محور 6 أكتوبر الصناعي',
    generatorEn: 'Sample Industrial Plant',
    generatorAr: 'منشأة صناعية نموذجية',
    carrierEn: 'Certified 3PL Carrier',
    carrierAr: 'ناقل بيئي مرخص (3PL)',
    hashPrefix: '9f84',
  },
  {
    code: 'PAS-SAMPLE-002',
    titleEn: 'Sorted Clear PET Bales — Grade A',
    titleAr: 'بالات PET شفاف مفروز — درجة A',
    corridorEn: '10th of Ramadan Corridor',
    corridorAr: 'محور العاشر من رمضان',
    generatorEn: 'Sample Commercial Hub',
    generatorAr: 'مركز تجاري نموذجي',
    carrierEn: 'Certified 3PL Carrier',
    carrierAr: 'ناقل بيئي مرخص (3PL)',
    hashPrefix: '4c21',
  },
  {
    code: 'PAS-SAMPLE-003',
    titleEn: 'Clean Aluminum Extrusion Trim — 6063',
    titleAr: 'قصاصات ألومنيوم نظيفة — سبيكة 6063',
    corridorEn: 'Sadat Industrial Zone',
    corridorAr: 'المنطقة الصناعية بالسادات',
    generatorEn: 'Sample Fabrication Facility',
    generatorAr: 'مصنع تشكيل معادن نموذجي',
    carrierEn: 'Certified 3PL Carrier',
    carrierAr: 'ناقل بيئي مرخص (3PL)',
    hashPrefix: '7d10',
  },
];

interface PassportStage {
  step: number;
  code: string;
  labelEn: string;
  labelAr: string;
  actorEn: string;
  actorAr: string;
  evidenceEn: string;
  evidenceAr: string;
  hashSuffix: string;
}

const PASSPORT_STAGES: PassportStage[] = [
  {
    step: 1,
    code: 'REGISTERED',
    labelEn: 'Registered',
    labelAr: 'مسجل',
    actorEn: 'Waste Generator Operations',
    actorAr: 'عمليات مولد المخلفات',
    evidenceEn: 'Source facility ID, stream taxonomy, initial batch weight',
    evidenceAr: 'معرف المنشأة، تصنيف الخامة، والوزن الابتدائي للتشغيلة',
    hashSuffix: 'c2e1...a71b',
  },
  {
    step: 2,
    code: 'SORTED',
    labelEn: 'Sorted',
    labelAr: 'مفروز',
    actorEn: 'On-Site Facility Coordinator',
    actorAr: 'منسق الفرز بالمنشأة',
    evidenceEn: 'Grade classification, moisture & contamination check',
    evidenceAr: 'تحديد الدرجة، فحص النقاء والرطوبة، وتجهيز البالات',
    hashSuffix: 'd9f0...c38e',
  },
  {
    step: 3,
    code: 'LISTED',
    labelEn: 'Listed',
    labelAr: 'معروض',
    actorEn: 'OURO Marketplace Index',
    actorAr: 'سوق OURO الرقمي',
    evidenceEn: 'Published lot specifications, pickup corridor, reserve window',
    evidenceAr: 'مواصفات التشغيلة المنشورة، نطاق الاستلام، ونافذة الحجز',
    hashSuffix: '51b4...f902',
  },
  {
    step: 4,
    code: 'RESERVED',
    labelEn: 'Reserved',
    labelAr: 'محجوز',
    actorEn: 'KYC-Verified Recycling Factory',
    actorAr: 'مصنع إعادة تدوير معتمد',
    evidenceEn: 'Atomic tonnage allocation & certified 3PL carrier assignment',
    evidenceAr: 'تخصيص الكمية وتعيين شركة النقل البيئي المرخصة (3PL)',
    hashSuffix: 'a8d7...e451',
  },
  {
    step: 5,
    code: 'PICKED_UP',
    labelEn: 'Picked Up',
    labelAr: 'تم الاستلام',
    actorEn: 'Certified 3PL Logistics Driver',
    actorAr: 'سائق نقل بيئي معتمد (3PL)',
    evidenceEn: 'QR departure scan, seal verification, outbound manifest',
    evidenceAr: 'مسح QR عند المغادرة، التحقق من الختم، وبوليصة الشحن',
    hashSuffix: 'f3c9...b120',
  },
  {
    step: 6,
    code: 'DELIVERED',
    labelEn: 'Delivered',
    labelAr: 'تم التسليم',
    actorEn: 'Receiving Factory Weighbridge',
    actorAr: 'ميزان بسكول المصنع المستلم',
    evidenceEn: 'Inbound QR custody scan & receiving weighbridge ticket',
    evidenceAr: 'مسح QR عند الوصول وإيصال ميزان الاستلام الرسمي',
    hashSuffix: 'e0a2...d619',
  },
  {
    step: 7,
    code: 'RECYCLED',
    labelEn: 'Recycled',
    labelAr: 'تم التدوير',
    actorEn: 'Verified Recycling Facility',
    actorAr: 'مرفق إعادة التدوير الموثق',
    evidenceEn: 'Mass-balance proof (recovered + residual) & ESG record lock',
    evidenceAr: 'إثبات اتزان الكتلة (المسترجع + الفاقد) وقفل سجل ESG',
    hashSuffix: 'b6e8...904c',
  },
];

interface MarketRow {
  id: string;
  category: Exclude<MaterialFilter, 'all'>;
  materialEn: string;
  materialAr: string;
  grade: string;
  corridorKey: string;
  corridorEn: string;
  corridorAr: string;
  availability: 'high' | 'moderate' | 'tight';
  availabilityRank: number;
  direction: 'up' | 'steady' | 'soft';
  cadenceEn: string;
  cadenceAr: string;
  packagingEn: string;
  packagingAr: string;
  vehicleEn: string;
  vehicleAr: string;
  specNoteEn: string;
  specNoteAr: string;
  sparkline: string;
}

const SAMPLE_MARKET_ROWS: MarketRow[] = [
  {
    id: 'occ-a',
    category: 'paper',
    materialEn: 'Corrugated Cardboard (OCC)',
    materialAr: 'كرتون مضلع (OCC)',
    grade: 'Grade A · Baled',
    corridorKey: 'cairo_oct',
    corridorEn: '6th of October — Greater Cairo',
    corridorAr: '6 أكتوبر — القاهرة الكبرى',
    availability: 'high',
    availabilityRank: 3,
    direction: 'up',
    cadenceEn: 'Weekly Lots',
    cadenceAr: 'تشغيلات أسبوعية',
    packagingEn: 'Mill-size hydraulic bales, dry-stored',
    packagingAr: 'بالات مكبوسة هيدروليكياً ومخزنة بمكان جاف',
    vehicleEn: 'Flatbed / Box 3PL Truck',
    vehicleAr: 'شاحنة 3PL مسطحة أو مغلقة',
    specNoteEn: 'Low moisture & low prohibitive-material tolerance',
    specNoteAr: 'نسبة رطوبة منخفضة وفرز نظيف من الشوائب',
    sparkline: '0,16 12,15 24,13 36,14 48,10 60,8 72,6',
  },
  {
    id: 'pet-clear',
    category: 'plastics',
    materialEn: 'Clear PET Bottles (Baled)',
    materialAr: 'بلاستيك PET شفاف (بالات)',
    grade: 'Grade A · Sorted',
    corridorKey: 'ramadan',
    corridorEn: '10th of Ramadan — Sharqia',
    corridorAr: 'العاشر من رمضان — الشرقية',
    availability: 'tight',
    availabilityRank: 1,
    direction: 'up',
    cadenceEn: 'High Demand',
    cadenceAr: 'طلب مرتفع',
    packagingEn: 'Color-sorted compressed bales',
    packagingAr: 'بالات مضغوطة مفروزة حسب اللون',
    vehicleEn: 'Covered 3PL Freight Carrier',
    vehicleAr: 'ناقل 3PL مغطى ومرخص',
    specNoteEn: 'Separated from colored PET and PVC liners',
    specNoteAr: 'مفصول عن العبوات الملونة وبقايا PVC',
    sparkline: '0,18 12,16 24,12 36,11 48,8 60,5 72,4',
  },
  {
    id: 'hdpe-rigid',
    category: 'plastics',
    materialEn: 'Industrial HDPE Drums & Crates',
    materialAr: 'بلاستيك HDPE صناعي',
    grade: 'Grade B · Rigid',
    corridorKey: 'alex',
    corridorEn: 'Borg El Arab — Alexandria',
    corridorAr: 'برج العرب — الإسكندرية',
    availability: 'moderate',
    availabilityRank: 2,
    direction: 'steady',
    cadenceEn: 'Bi-Weekly Lots',
    cadenceAr: 'تشغيلات نصف شهرية',
    packagingEn: 'Palletized or shredded rigid containers',
    packagingAr: 'عبوات صلبة على طبالي أو مفرومة أولياً',
    vehicleEn: 'High-Volume 3PL Container',
    vehicleAr: 'حاوية نقل 3PL عالية السعة',
    specNoteEn: 'Non-hazardous food/industrial packaging only',
    specNoteAr: 'عبوات صناعية غير خطرة فقط وموثقة المصدر',
    sparkline: '0,12 12,11 24,12 36,11 48,12 60,11 72,11',
  },
  {
    id: 'alu-scrap',
    category: 'metals',
    materialEn: 'Clean Aluminum Extrusion Trim',
    materialAr: 'قصاصات ألومنيوم صناعية نظيفة',
    grade: 'Alloy 6063 · Clean',
    corridorKey: 'sadat',
    corridorEn: 'Sadat City — Industrial Zone',
    corridorAr: 'مدينة السادات — المنطقة الصناعية',
    availability: 'tight',
    availabilityRank: 1,
    direction: 'up',
    cadenceEn: 'Contract Cadence',
    cadenceAr: 'توريد منتظم',
    packagingEn: 'Bundled offcuts & sealed stillages',
    packagingAr: 'حزم مقصوصات وصناديق معدنية مختومة',
    vehicleEn: 'Sealed 3PL Weighbridge Fleet',
    vehicleAr: 'أسطول 3PL مختوم وموزون بالبسكول',
    specNoteEn: 'Unpainted alloy trim free of ferrous attachments',
    specNoteAr: 'قصاصات غير مطلية خالية من المعادن الحديدية',
    sparkline: '0,17 12,15 24,14 36,10 48,9 60,7 72,5',
  },
  {
    id: 'glass-cullet',
    category: 'glass',
    materialEn: 'Sorted Flint Glass Cullet',
    materialAr: 'كسر زجاج شفاف مفروز',
    grade: 'Color-Sorted',
    corridorKey: 'giza',
    corridorEn: 'Giza — Hospitality Corridor',
    corridorAr: 'الجيزة — قطاع الفنادق',
    availability: 'moderate',
    availabilityRank: 2,
    direction: 'soft',
    cadenceEn: 'Seasonal Flow',
    cadenceAr: 'تدفق موسمي',
    packagingEn: 'Jumbo FIBC bags (color-separated)',
    packagingAr: 'أكياس جامبو مفروزة اللون',
    vehicleEn: 'Tipper / Heavy 3PL Carrier',
    vehicleAr: 'شاحنة 3PL للحمولات الثقيلة',
    specNoteEn: 'Free of ceramic, stone, and laminated panes',
    specNoteAr: 'خالٍ من السيراميك والأحجار والزجاج المصفح',
    sparkline: '0,8 12,9 24,10 36,11 48,13 60,14 72,14',
  },
];

interface ForecastDataPoint {
  labelEn: string;
  labelAr: string;
  supplyY: number;
  demandY: number;
  bandTop: number;
  bandBottom: number;
  projected: boolean;
}

const FORECAST_POINTS: Record<
  ForecastHorizon,
  Record<ForecastStream, ForecastDataPoint[]>
> = {
  '30d': {
    all: [
      { labelEn: 'W-4', labelAr: 'أ-4', supplyY: 126, demandY: 122, bandTop: 126, bandBottom: 126, projected: false },
      { labelEn: 'W-3', labelAr: 'أ-3', supplyY: 118, demandY: 114, bandTop: 118, bandBottom: 118, projected: false },
      { labelEn: 'W-2', labelAr: 'أ-2', supplyY: 112, demandY: 108, bandTop: 112, bandBottom: 112, projected: false },
      { labelEn: 'Now', labelAr: 'الآن', supplyY: 102, demandY: 98, bandTop: 102, bandBottom: 102, projected: false },
      { labelEn: 'W+1', labelAr: 'أ+1', supplyY: 96, demandY: 86, bandTop: 84, bandBottom: 108, projected: true },
      { labelEn: 'W+2', labelAr: 'أ+2', supplyY: 92, demandY: 74, bandTop: 78, bandBottom: 108, projected: true },
      { labelEn: 'W+3', labelAr: 'أ+3', supplyY: 88, demandY: 68, bandTop: 72, bandBottom: 106, projected: true },
      { labelEn: 'W+4', labelAr: 'أ+4', supplyY: 84, demandY: 62, bandTop: 66, bandBottom: 104, projected: true },
    ],
    paper: [
      { labelEn: 'W-4', labelAr: 'أ-4', supplyY: 116, demandY: 124, bandTop: 116, bandBottom: 116, projected: false },
      { labelEn: 'W-3', labelAr: 'أ-3', supplyY: 108, demandY: 118, bandTop: 108, bandBottom: 108, projected: false },
      { labelEn: 'W-2', labelAr: 'أ-2', supplyY: 100, demandY: 112, bandTop: 100, bandBottom: 100, projected: false },
      { labelEn: 'Now', labelAr: 'الآن', supplyY: 92, demandY: 104, bandTop: 92, bandBottom: 92, projected: false },
      { labelEn: 'W+1', labelAr: 'أ+1', supplyY: 82, demandY: 98, bandTop: 70, bandBottom: 96, projected: true },
      { labelEn: 'W+2', labelAr: 'أ+2', supplyY: 76, demandY: 94, bandTop: 62, bandBottom: 92, projected: true },
      { labelEn: 'W+3', labelAr: 'أ+3', supplyY: 72, demandY: 90, bandTop: 56, bandBottom: 90, projected: true },
      { labelEn: 'W+4', labelAr: 'أ+4', supplyY: 68, demandY: 88, bandTop: 50, bandBottom: 88, projected: true },
    ],
    plastics: [
      { labelEn: 'W-4', labelAr: 'أ-4', supplyY: 130, demandY: 118, bandTop: 130, bandBottom: 130, projected: false },
      { labelEn: 'W-3', labelAr: 'أ-3', supplyY: 126, demandY: 110, bandTop: 126, bandBottom: 126, projected: false },
      { labelEn: 'W-2', labelAr: 'أ-2', supplyY: 122, demandY: 100, bandTop: 122, bandBottom: 122, projected: false },
      { labelEn: 'Now', labelAr: 'الآن', supplyY: 116, demandY: 92, bandTop: 116, bandBottom: 116, projected: false },
      { labelEn: 'W+1', labelAr: 'أ+1', supplyY: 112, demandY: 80, bandTop: 100, bandBottom: 124, projected: true },
      { labelEn: 'W+2', labelAr: 'أ+2', supplyY: 108, demandY: 70, bandTop: 94, bandBottom: 122, projected: true },
      { labelEn: 'W+3', labelAr: 'أ+3', supplyY: 104, demandY: 60, bandTop: 88, bandBottom: 120, projected: true },
      { labelEn: 'W+4', labelAr: 'أ+4', supplyY: 100, demandY: 54, bandTop: 82, bandBottom: 118, projected: true },
    ],
    metals: [
      { labelEn: 'W-4', labelAr: 'أ-4', supplyY: 124, demandY: 120, bandTop: 124, bandBottom: 124, projected: false },
      { labelEn: 'W-3', labelAr: 'أ-3', supplyY: 120, demandY: 116, bandTop: 120, bandBottom: 120, projected: false },
      { labelEn: 'W-2', labelAr: 'أ-2', supplyY: 118, demandY: 112, bandTop: 118, bandBottom: 118, projected: false },
      { labelEn: 'Now', labelAr: 'الآن', supplyY: 114, demandY: 106, bandTop: 114, bandBottom: 114, projected: false },
      { labelEn: 'W+1', labelAr: 'أ+1', supplyY: 110, demandY: 98, bandTop: 98, bandBottom: 122, projected: true },
      { labelEn: 'W+2', labelAr: 'أ+2', supplyY: 108, demandY: 92, bandTop: 94, bandBottom: 122, projected: true },
      { labelEn: 'W+3', labelAr: 'أ+3', supplyY: 106, demandY: 84, bandTop: 90, bandBottom: 122, projected: true },
      { labelEn: 'W+4', labelAr: 'أ+4', supplyY: 104, demandY: 78, bandTop: 86, bandBottom: 122, projected: true },
    ],
  },
  '90d': {
    all: [
      { labelEn: 'M-3', labelAr: 'ش-3', supplyY: 132, demandY: 126, bandTop: 132, bandBottom: 132, projected: false },
      { labelEn: 'M-2', labelAr: 'ش-2', supplyY: 120, demandY: 116, bandTop: 120, bandBottom: 120, projected: false },
      { labelEn: 'M-1', labelAr: 'ش-1', supplyY: 108, demandY: 106, bandTop: 108, bandBottom: 108, projected: false },
      { labelEn: 'Now', labelAr: 'الآن', supplyY: 104, demandY: 96, bandTop: 104, bandBottom: 104, projected: false },
      { labelEn: 'M+1', labelAr: 'ش+1', supplyY: 90, demandY: 84, bandTop: 76, bandBottom: 104, projected: true },
      { labelEn: 'M+2', labelAr: 'ش+2', supplyY: 76, demandY: 80, bandTop: 60, bandBottom: 94, projected: true },
      { labelEn: 'M+3', labelAr: 'ش+3', supplyY: 72, demandY: 78, bandTop: 54, bandBottom: 92, projected: true },
      { labelEn: 'Q+1', labelAr: 'ر+1', supplyY: 68, demandY: 74, bandTop: 48, bandBottom: 90, projected: true },
    ],
    paper: [
      { labelEn: 'M-3', labelAr: 'ش-3', supplyY: 122, demandY: 126, bandTop: 122, bandBottom: 122, projected: false },
      { labelEn: 'M-2', labelAr: 'ش-2', supplyY: 110, demandY: 118, bandTop: 110, bandBottom: 110, projected: false },
      { labelEn: 'M-1', labelAr: 'ش-1', supplyY: 98, demandY: 110, bandTop: 98, bandBottom: 98, projected: false },
      { labelEn: 'Now', labelAr: 'الآن', supplyY: 90, demandY: 104, bandTop: 90, bandBottom: 90, projected: false },
      { labelEn: 'M+1', labelAr: 'ش+1', supplyY: 78, demandY: 98, bandTop: 64, bandBottom: 92, projected: true },
      { labelEn: 'M+2', labelAr: 'ش+2', supplyY: 68, demandY: 94, bandTop: 52, bandBottom: 86, projected: true },
      { labelEn: 'M+3', labelAr: 'ش+3', supplyY: 62, demandY: 90, bandTop: 44, bandBottom: 82, projected: true },
      { labelEn: 'Q+1', labelAr: 'ر+1', supplyY: 58, demandY: 86, bandTop: 40, bandBottom: 78, projected: true },
    ],
    plastics: [
      { labelEn: 'M-3', labelAr: 'ش-3', supplyY: 134, demandY: 120, bandTop: 134, bandBottom: 134, projected: false },
      { labelEn: 'M-2', labelAr: 'ش-2', supplyY: 126, demandY: 108, bandTop: 126, bandBottom: 126, projected: false },
      { labelEn: 'M-1', labelAr: 'ش-1', supplyY: 118, demandY: 96, bandTop: 118, bandBottom: 118, projected: false },
      { labelEn: 'Now', labelAr: 'الآن', supplyY: 112, demandY: 88, bandTop: 112, bandBottom: 112, projected: false },
      { labelEn: 'M+1', labelAr: 'ش+1', supplyY: 104, demandY: 76, bandTop: 90, bandBottom: 118, projected: true },
      { labelEn: 'M+2', labelAr: 'ش+2', supplyY: 98, demandY: 68, bandTop: 82, bandBottom: 114, projected: true },
      { labelEn: 'M+3', labelAr: 'ش+3', supplyY: 94, demandY: 62, bandTop: 76, bandBottom: 112, projected: true },
      { labelEn: 'Q+1', labelAr: 'ر+1', supplyY: 88, demandY: 56, bandTop: 68, bandBottom: 108, projected: true },
    ],
    metals: [
      { labelEn: 'M-3', labelAr: 'ش-3', supplyY: 126, demandY: 122, bandTop: 126, bandBottom: 126, projected: false },
      { labelEn: 'M-2', labelAr: 'ش-2', supplyY: 122, demandY: 116, bandTop: 122, bandBottom: 122, projected: false },
      { labelEn: 'M-1', labelAr: 'ش-1', supplyY: 116, demandY: 108, bandTop: 116, bandBottom: 116, projected: false },
      { labelEn: 'Now', labelAr: 'الآن', supplyY: 112, demandY: 100, bandTop: 112, bandBottom: 112, projected: false },
      { labelEn: 'M+1', labelAr: 'ش+1', supplyY: 106, demandY: 90, bandTop: 92, bandBottom: 120, projected: true },
      { labelEn: 'M+2', labelAr: 'ش+2', supplyY: 102, demandY: 82, bandTop: 86, bandBottom: 118, projected: true },
      { labelEn: 'M+3', labelAr: 'ش+3', supplyY: 98, demandY: 76, bandTop: 80, bandBottom: 116, projected: true },
      { labelEn: 'Q+1', labelAr: 'ر+1', supplyY: 96, demandY: 70, bandTop: 76, bandBottom: 116, projected: true },
    ],
  },
  seasonal: {
    all: [
      { labelEn: 'Q1', labelAr: 'ر1', supplyY: 118, demandY: 114, bandTop: 118, bandBottom: 118, projected: false },
      { labelEn: 'Q2', labelAr: 'ر2', supplyY: 100, demandY: 96, bandTop: 100, bandBottom: 100, projected: false },
      { labelEn: 'Q3', labelAr: 'ر3', supplyY: 116, demandY: 102, bandTop: 116, bandBottom: 116, projected: false },
      { labelEn: 'Now', labelAr: 'الآن', supplyY: 104, demandY: 92, bandTop: 104, bandBottom: 104, projected: false },
      { labelEn: 'Q4*', labelAr: 'ر4*', supplyY: 86, demandY: 76, bandTop: 70, bandBottom: 102, projected: true },
      { labelEn: 'Q1*', labelAr: 'ر1*', supplyY: 98, demandY: 82, bandTop: 82, bandBottom: 114, projected: true },
      { labelEn: 'Q2*', labelAr: 'ر2*', supplyY: 78, demandY: 68, bandTop: 60, bandBottom: 98, projected: true },
      { labelEn: 'Q3*', labelAr: 'ر3*', supplyY: 66, demandY: 58, bandTop: 46, bandBottom: 88, projected: true },
    ],
    paper: [
      { labelEn: 'Q1', labelAr: 'ر1', supplyY: 114, demandY: 118, bandTop: 114, bandBottom: 114, projected: false },
      { labelEn: 'Q2', labelAr: 'ر2', supplyY: 94, demandY: 102, bandTop: 94, bandBottom: 94, projected: false },
      { labelEn: 'Q3', labelAr: 'ر3', supplyY: 106, demandY: 108, bandTop: 106, bandBottom: 106, projected: false },
      { labelEn: 'Now', labelAr: 'الآن', supplyY: 92, demandY: 98, bandTop: 92, bandBottom: 92, projected: false },
      { labelEn: 'Q4*', labelAr: 'ر4*', supplyY: 74, demandY: 84, bandTop: 58, bandBottom: 90, projected: true },
      { labelEn: 'Q1*', labelAr: 'ر1*', supplyY: 88, demandY: 92, bandTop: 72, bandBottom: 104, projected: true },
      { labelEn: 'Q2*', labelAr: 'ر2*', supplyY: 68, demandY: 80, bandTop: 50, bandBottom: 86, projected: true },
      { labelEn: 'Q3*', labelAr: 'ر3*', supplyY: 62, demandY: 74, bandTop: 42, bandBottom: 82, projected: true },
    ],
    plastics: [
      { labelEn: 'Q1', labelAr: 'ر1', supplyY: 124, demandY: 110, bandTop: 124, bandBottom: 124, projected: false },
      { labelEn: 'Q2', labelAr: 'ر2', supplyY: 96, demandY: 86, bandTop: 96, bandBottom: 96, projected: false },
      { labelEn: 'Q3', labelAr: 'ر3', supplyY: 112, demandY: 90, bandTop: 112, bandBottom: 112, projected: false },
      { labelEn: 'Now', labelAr: 'الآن', supplyY: 106, demandY: 84, bandTop: 106, bandBottom: 106, projected: false },
      { labelEn: 'Q4*', labelAr: 'ر4*', supplyY: 94, demandY: 72, bandTop: 78, bandBottom: 110, projected: true },
      { labelEn: 'Q1*', labelAr: 'ر1*', supplyY: 104, demandY: 78, bandTop: 88, bandBottom: 120, projected: true },
      { labelEn: 'Q2*', labelAr: 'ر2*', supplyY: 82, demandY: 60, bandTop: 64, bandBottom: 100, projected: true },
      { labelEn: 'Q3*', labelAr: 'ر3*', supplyY: 74, demandY: 52, bandTop: 54, bandBottom: 94, projected: true },
    ],
    metals: [
      { labelEn: 'Q1', labelAr: 'ر1', supplyY: 120, demandY: 118, bandTop: 120, bandBottom: 120, projected: false },
      { labelEn: 'Q2', labelAr: 'ر2', supplyY: 112, demandY: 106, bandTop: 112, bandBottom: 112, projected: false },
      { labelEn: 'Q3', labelAr: 'ر3', supplyY: 118, demandY: 108, bandTop: 118, bandBottom: 118, projected: false },
      { labelEn: 'Now', labelAr: 'الآن', supplyY: 110, demandY: 98, bandTop: 110, bandBottom: 110, projected: false },
      { labelEn: 'Q4*', labelAr: 'ر4*', supplyY: 102, demandY: 86, bandTop: 88, bandBottom: 116, projected: true },
      { labelEn: 'Q1*', labelAr: 'ر1*', supplyY: 106, demandY: 88, bandTop: 90, bandBottom: 122, projected: true },
      { labelEn: 'Q2*', labelAr: 'ر2*', supplyY: 96, demandY: 76, bandTop: 78, bandBottom: 114, projected: true },
      { labelEn: 'Q3*', labelAr: 'ر3*', supplyY: 92, demandY: 70, bandTop: 72, bandBottom: 112, projected: true },
    ],
  },
};

interface DecisionLot {
  id: string;
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  purityRank: number;
  proximityRank: number;
  pickupRank: number;
  badgeEn: string;
  badgeAr: string;
}

const DECISION_MATCH_LOTS: DecisionLot[] = [
  {
    id: 'lot-occ-a',
    titleEn: 'Sample Lot · OCC Grade A (Industrial Generator)',
    titleAr: 'دفعة نموذجية · كرتون OCC درجة A (مولد صناعي)',
    subtitleEn: 'High Purity Spec · Adjacent Corridor · 3PL Dock Scheduled',
    subtitleAr: 'نقاء عالٍ · محور صناعي مجاور · رصيف 3PL مجدول',
    purityRank: 3,
    proximityRank: 2,
    pickupRank: 2,
    badgeEn: 'Top Purity Fit',
    badgeAr: 'أعلى نقاء',
  },
  {
    id: 'lot-pet-a',
    titleEn: 'Sample Lot · Sorted Clear PET (Commercial Facility)',
    titleAr: 'دفعة نموذجية · PET شفاف مفروز (مركز تجاري)',
    subtitleEn: 'Sorting Log Attached · Immediate 3PL Pickup Slot · Verified',
    subtitleAr: 'سجل فرز موثق · نافذة استلام فورية 3PL · منشأة معتمدة',
    purityRank: 2,
    proximityRank: 1,
    pickupRank: 3,
    badgeEn: 'Fastest Pickup',
    badgeAr: 'أسرع استلام',
  },
  {
    id: 'lot-hdpe-b',
    titleEn: 'Sample Lot · Rigid Industrial HDPE (Logistics Hub)',
    titleAr: 'دفعة نموذجية · براميل HDPE صناعية (مركز لوجستي)',
    subtitleEn: 'Same Industrial Zone · Short Haul Corridor · Baled',
    subtitleAr: 'نفس المنطقة الصناعية · مسافة نقل قصيرة · بالات جاهزة',
    purityRank: 1,
    proximityRank: 3,
    pickupRank: 1,
    badgeEn: 'Shortest Corridor',
    badgeAr: 'أقرب محور',
  },
];

const REVEAL_TRANSITION = {
  duration: 0.45,
  ease: [0.16, 1, 0.3, 1] as const,
};

export const TechnologyShowcase: React.FC<TechnologyShowcaseProps> = ({
  lang = 'en',
  onSelectPortalRole,
}) => {
  const isAr = lang === 'ar';

  // Global view mode (Alternating 5-row layout by default, or Interactive Spotlight switcher)
  const [layoutMode, setLayoutMode] = useState<ViewLayoutMode>('alternating');
  const [spotlightIndex, setSpotlightIndex] = useState<number>(0);

  // Layer 01 — Digital Waste Passport interactive state
  const [selectedLotIdx, setSelectedLotIdx] = useState<number>(0);
  const [activeStage, setActiveStage] = useState<number>(5);
  const [isPlayingPassport, setIsPlayingPassport] = useState<boolean>(false);
  const [chainVerified, setChainVerified] = useState<boolean>(false);

  // Layer 02 — Market Intelligence interactive state
  const [materialFilter, setMaterialFilter] = useState<MaterialFilter>('all');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all');
  const [sortByAvailabilityDesc, setSortByAvailabilityDesc] = useState<boolean>(true);
  const [selectedMarketRowId, setSelectedMarketRowId] = useState<string>('occ-a');

  // Layer 03 — Predictive Analytics interactive state
  const [forecastHorizon, setForecastHorizon] = useState<ForecastHorizon>('30d');
  const [forecastStream, setForecastStream] = useState<ForecastStream>('all');
  const [selectedPeriodIdx, setSelectedPeriodIdx] = useState<number>(5);

  // Layer 04 — Industrial Decision Intelligence interactive state
  const [decisionMode, setDecisionMode] = useState<DecisionMode>('matching');
  const [matchPriority, setMatchPriority] = useState<MatchPriority>('purity');
  const [reservedSampleLots, setReservedSampleLots] = useState<string[]>([]);
  const [runRate, setRunRate] = useState<RunRateLevel>('standard');
  const [consolidatedBatch, setConsolidatedBatch] = useState<boolean>(true);

  // Layer 05 — Verified Environmental Intelligence interactive state
  const [verificationGate, setVerificationGate] = useState<VerificationGate>('recycled');
  const [sampleDeliveredUnits, setSampleDeliveredUnits] = useState<number>(100);
  const [sampleRecoveryPct, setSampleRecoveryPct] = useState<number>(88);
  const [sampleProcessLossPct, setSampleProcessLossPct] = useState<number>(4);

  // Auto-advance walkthrough timer for Layer 01
  useEffect(() => {
    if (!isPlayingPassport) return;
    const timer = window.setInterval(() => {
      setActiveStage((prev) => {
        if (prev >= 7) {
          setIsPlayingPassport(false);
          return 7;
        }
        return prev + 1;
      });
    }, 1150);
    return () => window.clearInterval(timer);
  }, [isPlayingPassport]);

  const currentLot = SAMPLE_PASSPORT_LOTS[selectedLotIdx] ?? SAMPLE_PASSPORT_LOTS[0];
  const selectedStage =
    PASSPORT_STAGES.find((s) => s.step === activeStage) ?? PASSPORT_STAGES[4];

  // Filtered & sorted Market rows for Layer 02
  const filteredMarketRows = useMemo(() => {
    const base = SAMPLE_MARKET_ROWS.filter((row) => {
      if (materialFilter !== 'all' && row.category !== materialFilter) return false;
      if (availabilityFilter !== 'all' && row.availability !== availabilityFilter) return false;
      return true;
    });
    return [...base].sort((a, b) =>
      sortByAvailabilityDesc
        ? b.availabilityRank - a.availabilityRank
        : a.availabilityRank - b.availabilityRank
    );
  }, [materialFilter, availabilityFilter, sortByAvailabilityDesc]);

  const inspectedMarketRow =
    filteredMarketRows.find((r) => r.id === selectedMarketRowId) ??
    filteredMarketRows[0] ??
    SAMPLE_MARKET_ROWS[0];

  // Forecast points & SVG geometry for Layer 03
  const forecastPoints = FORECAST_POINTS[forecastHorizon][forecastStream];
  const clampedPeriodIdx = Math.min(selectedPeriodIdx, forecastPoints.length - 1);
  const inspectedPeriod = forecastPoints[clampedPeriodIdx];

  const histSupplyPolyline = forecastPoints
    .slice(0, 4)
    .map((p, idx) => `${20 + idx * 64},${p.supplyY}`)
    .join(' ');
  const projSupplyPolyline = forecastPoints
    .slice(3)
    .map((p, idx) => `${20 + (idx + 3) * 64},${p.supplyY}`)
    .join(' ');
  const demandPolyline = forecastPoints
    .map((p, idx) => `${20 + idx * 64},${p.demandY}`)
    .join(' ');
  const projBandPolygon = [
    ...forecastPoints.slice(3).map((p, idx) => `${20 + (idx + 3) * 64},${p.bandTop}`),
    ...forecastPoints
      .slice(3)
      .reverse()
      .map((p, idx) => `${20 + (forecastPoints.length - 1 - idx) * 64},${p.bandBottom}`),
  ].join(' ');

  // Gap calculation for Layer 03 Period Inspector (lower SVG Y = higher index)
  const periodGap = inspectedPeriod.demandY - inspectedPeriod.supplyY;
  const periodStatus =
    periodGap > 6
      ? {
          en: 'Projected Surplus Window',
          ar: 'نافذة فائض متوقع',
          tone: 'text-[#68A899]',
        }
      : periodGap < -6
      ? {
          en: 'Tightening Supply Signal',
          ar: 'مؤشر عجز أو ضغط معروض',
          tone: 'text-[#C4A87E]',
        }
      : {
          en: 'Balanced Supply & Demand',
          ar: 'توازن بين العرض والطلب',
          tone: 'text-[#E2E7E7]',
        };

  // Ranked Decision Matching Lots for Layer 04
  const rankedDecisionLots = useMemo(() => {
    return [...DECISION_MATCH_LOTS].sort((a, b) => {
      if (matchPriority === 'purity') return b.purityRank - a.purityRank;
      if (matchPriority === 'proximity') return b.proximityRank - a.proximityRank;
      return b.pickupRank - a.pickupRank;
    });
  }, [matchPriority]);

  // Interactive Mass-Balance Sandbox numbers for Layer 05 (strictly illustrative ratios)
  const safeLossPct = Math.min(sampleProcessLossPct, 100 - sampleRecoveryPct);
  const residualPct = Math.max(0, 100 - sampleRecoveryPct - safeLossPct);
  const recoveredUnits = Math.round((sampleDeliveredUnits * sampleRecoveryPct) / 100);
  const lossUnits = Math.round((sampleDeliveredUnits * safeLossPct) / 100);
  const residualUnits = Math.max(0, sampleDeliveredUnits - recoveredUnits - lossUnits);
  const reconciledSum = recoveredUnits + residualUnits + lossUnits;

  const toggleSampleReserve = (lotId: string) => {
    setReservedSampleLots((prev) =>
      prev.includes(lotId) ? prev.filter((id) => id !== lotId) : [...prev, lotId]
    );
  };

  const triggerRoleAction = (role: UserRole, mode: 'login' | 'register' = 'login') => {
    if (onSelectPortalRole) {
      onSelectPortalRole(role, mode);
    } else {
      const portalEl = document.getElementById('portal-access');
      if (portalEl) {
        portalEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const layerNav = [
    {
      num: '01',
      id: 'tech-layer-01',
      en: 'Waste Passport & Tracking',
      ar: 'جواز المخلفات والتتبع',
    },
    {
      num: '02',
      id: 'tech-layer-02',
      en: 'Market Intelligence',
      ar: 'ذكاء سوق المخلفات',
    },
    {
      num: '03',
      id: 'tech-layer-03',
      en: 'Predictive Analytics',
      ar: 'التحليلات التنبؤية',
    },
    {
      num: '04',
      id: 'tech-layer-04',
      en: 'Industrial Decisions',
      ar: 'ذكاء القرار الصناعي',
    },
    {
      num: '05',
      id: 'tech-layer-05',
      en: 'Environmental Intelligence',
      ar: 'الذكاء البيئي الموثق',
    },
  ];

  const handleNavClick = (index: number, id: string) => {
    setSpotlightIndex(index);
    if (layoutMode === 'alternating') {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const showLayer = (idx: number) => layoutMode === 'alternating' || spotlightIndex === idx;

  return (
    <section
      id="intelligence-layers"
      aria-labelledby="technology-showcase-heading"
      className="w-full bg-[#F6F7F7] text-[#272F31] border-t border-[#A88B64]/25"
    >
      {/* Section Header + Interactive Mode Switcher & Capability Navigator */}
      <div className="w-full max-w-7xl mx-auto px-6 pt-16 pb-10 sm:pt-20 sm:pb-12">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={REVEAL_TRANSITION}
            className="max-w-3xl space-y-4"
          >
            <p className="text-xs font-semibold tracking-wider uppercase text-[#3D7568]">
              {isAr
                ? 'معاينة تفاعلية للمنصة · خمس طبقات متكاملة'
                : 'Interactive Platform Showcase · Five Integrated Layers'}
            </p>
            <h2
              id="technology-showcase-heading"
              className="text-3xl sm:text-4xl lg:text-[2.75rem] font-extrabold tracking-tight text-[#1C2325] leading-[1.12] [text-wrap:balance]"
            >
              {isAr
                ? 'منصة واحدة. خمس طبقات للذكاء التشغيلي.'
                : 'One Platform. Five Intelligence Layers.'}
            </h2>
            <p className="text-base sm:text-lg text-[#4A5558] leading-relaxed">
              {isAr
                ? 'تربط OURO بين تتبع المخلفات، وذكاء السوق، والتحليلات التنبؤية، ودعم القرار الصناعي، والأداء البيئي الموثق في منصة متكاملة واحدة للاقتصاد الدائري.'
                : 'OURO connects waste traceability, market intelligence, predictive analytics, industrial decision-making, and verified environmental performance in one integrated circular economy platform.'}
            </p>
          </motion.div>

          {/* Interactive View Mode Toggle */}
          <div className="shrink-0">
            <div
              role="group"
              aria-label={isAr ? 'وضع عرض الطبقات' : 'Showcase display mode'}
              className="inline-flex rounded-xl bg-white border border-[#D4DDDD] p-1 gap-1 shadow-xs"
            >
              <button
                type="button"
                onClick={() => setLayoutMode('alternating')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  layoutMode === 'alternating'
                    ? 'bg-[#272F31] text-white'
                    : 'text-[#4A5558] hover:text-[#1C2325]'
                }`}
              >
                {isAr ? 'عرض جميع الطبقات' : 'All 5 Layers'}
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('spotlight')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  layoutMode === 'spotlight'
                    ? 'bg-[#3D7568] text-white'
                    : 'text-[#4A5558] hover:text-[#1C2325]'
                }`}
              >
                {isAr ? 'جولة تفاعلية مركزة' : 'Interactive Tour'}
              </button>
            </div>
          </div>
        </div>

        {/* Interactive 5-Layer Index Strip */}
        <nav
          aria-label={isAr ? 'طبقات التكنولوجيا الخمس' : 'Five Intelligence Layers Navigation'}
          className="mt-8 pt-6 border-t border-[#D8DFDF] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5"
        >
          {layerNav.map((item, idx) => {
            const isActive = layoutMode === 'spotlight' && spotlightIndex === idx;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(idx, item.id)}
                className={`group text-start rounded-xl border px-3.5 py-3 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3D7568] ${
                  isActive
                    ? 'bg-[#272F31] border-[#272F31] text-white shadow-md'
                    : 'bg-white border-[#DCE2E2] hover:border-[#3D7568] text-[#272F31]'
                }`}
              >
                <span
                  className={`block font-mono text-xs font-bold tabular-nums ${
                    isActive
                      ? 'text-[#C4A87E]'
                      : 'text-[#826946] group-hover:text-[#3D7568]'
                  }`}
                >
                  {item.num}
                </span>
                <span
                  className={`mt-1 block text-xs sm:text-[13px] font-semibold leading-snug ${
                    isActive ? 'text-white' : 'text-[#272F31]'
                  }`}
                >
                  {isAr ? item.ar : item.en}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Spotlight Tour Prev / Next Controls */}
        {layoutMode === 'spotlight' && (
          <div className="mt-4 flex items-center justify-between gap-4 text-xs text-[#4A5558]">
            <span className="font-mono font-semibold text-[#3D7568] tabular-nums">
              {isAr
                ? `الطبقة ${spotlightIndex + 1} من 5`
                : `Layer 0${spotlightIndex + 1} of 05 · Interactive Tour`}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSpotlightIndex((i) => (i === 0 ? 4 : i - 1))}
                className="inline-flex items-center gap-1 rounded-lg bg-white border border-[#D4DDDD] hover:border-[#3D7568] px-3 py-1.5 font-semibold text-[#1C2325] transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>{isAr ? 'السابق' : 'Previous'}</span>
              </button>
              <button
                type="button"
                onClick={() => setSpotlightIndex((i) => (i === 4 ? 0 : i + 1))}
                className="inline-flex items-center gap-1 rounded-lg bg-[#272F31] hover:bg-[#333D40] px-3 py-1.5 font-semibold text-white transition-colors"
              >
                <span>{isAr ? 'التالي' : 'Next Layer'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Alternating Five-Layer Interactive Showcase */}
      <div className="w-full max-w-7xl mx-auto px-6 pb-20 space-y-20 lg:space-y-24">
        {/* ===================================================================
            01 — DIGITAL WASTE PASSPORT & TRACKING (Text Left / Preview Right)
        =================================================================== */}
        {showLayer(0) && (
          <motion.article
            id="tech-layer-01"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.12 }}
            transition={REVEAL_TRANSITION}
            className="scroll-mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center"
          >
            {/* Text Column (Left) */}
            <div className="lg:col-span-5 space-y-5">
              <div className="flex items-center gap-3 text-sm font-mono font-bold text-[#3D7568] tabular-nums">
                <span>01</span>
                <span className="h-px w-8 bg-[#A88B64]" aria-hidden="true" />
                <span className="font-sans text-xs font-semibold uppercase tracking-wider text-[#627073]">
                  {isAr ? 'التتبع وسلسلة الحيازة' : 'Traceability & Custody'}
                </span>
              </div>

              <h3 className="text-2xl sm:text-3xl font-extrabold text-[#1C2325] leading-tight [text-wrap:balance]">
                {isAr ? 'جواز المخلفات الرقمي والتتبع' : 'Digital Waste Passport & Tracking'}
              </h3>

              <p className="text-sm sm:text-base text-[#4A5558] leading-relaxed">
                {isAr
                  ? 'تتبع كل شحنة من مولد المخلفات إلى شركة النقل البيئي وحتى مرفق إعادة التدوير عبر جواز رقمي فريد، وتعريف QR، وسجل أحداث كامل، والمستندات الداعمة.'
                  : 'Track every shipment from waste generator to transporter to recycling facility through a unique digital passport, QR identification, event history, and supporting documentation.'}
              </p>

              <ul className="space-y-2.5 pt-3 border-t border-[#DCE2E2] text-sm text-[#272F31]">
                <li className="flex items-start gap-2.5">
                  <QrCode className="w-4 h-4 text-[#3D7568] shrink-0 mt-0.5" />
                  <span>
                    {isAr
                      ? 'بدّل بين تشغيلات نموذجية وجرّب مسح QR عبر المراحل السبع'
                      : 'Switch sample lots and step through live QR custody handoffs'}
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <GitBranch className="w-4 h-4 text-[#3D7568] shrink-0 mt-0.5" />
                  <span>
                    {isAr
                      ? 'سجل أحداث غير قابل للتلاعب مرتبط بتشفير SHA-256 لكل مرحلة'
                      : 'Verify tamper-evident SHA-256 hash linkage across every lifecycle stage'}
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <FileCheck2 className="w-4 h-4 text-[#3D7568] shrink-0 mt-0.5" />
                  <span>
                    {isAr
                      ? 'توثيق رقمي لإيصالات الميزان وبوالص النقل وإثبات إعادة التدوير'
                      : 'Structured records for weighbridge tickets, manifests, and recycling proof'}
                  </span>
                </li>
              </ul>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => triggerRoleAction('generator_ops', 'login')}
                  className="inline-flex items-center gap-2 text-sm font-bold text-[#3D7568] hover:text-[#1C2325] transition-colors whitespace-nowrap"
                >
                  <span>
                    {isAr ? 'الدخول لبوابة مولد المخلفات' : 'Access Generator Passport Portal'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Interactive Passport Simulator (Right) */}
            <div className="lg:col-span-7">
              <div className="rounded-2xl bg-[#1C2325] text-[#FBFCFD] border border-[#A88B64]/25 shadow-xl overflow-hidden">
                <div className="px-5 py-3.5 bg-[#151B1D] border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <QrCode className="w-4 h-4 text-[#68A899]" />
                    <span className="text-xs font-bold tracking-wide text-[#FBFCFD]">
                      {isAr ? 'محاكي جواز المخلفات الرقمي' : 'Interactive Waste Passport Simulator'}
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-[#C4A87E]">
                    {isAr
                      ? 'معاينة تفاعلية توضيحية · بيانات نموذجية'
                      : 'Interactive Product Preview · Sample Data'}
                  </span>
                </div>

                <div className="p-5 sm:p-6 space-y-5">
                  {/* Interactive Sample Lot Switcher */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sample waste lots">
                      {SAMPLE_PASSPORT_LOTS.map((lot, idx) => (
                        <button
                          key={lot.code}
                          type="button"
                          onClick={() => {
                            setSelectedLotIdx(idx);
                            setChainVerified(false);
                          }}
                          className={`px-2.5 py-1.5 rounded-lg font-mono text-[11px] font-semibold transition-colors ${
                            selectedLotIdx === idx
                              ? 'bg-[#3D7568] text-white'
                              : 'bg-white/6 text-[#CBD2D3] hover:bg-white/12 hover:text-white'
                          }`}
                        >
                          {lot.code}
                        </button>
                      ))}
                    </div>

                    {/* Auto-Walkthrough Play / Pause + Reset */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (!isPlayingPassport && activeStage >= 7) {
                            setActiveStage(1);
                          }
                          setIsPlayingPassport((p) => !p);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/16 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors"
                      >
                        {isPlayingPassport ? (
                          <>
                            <Pause className="w-3 h-3 text-[#C4A87E]" />
                            <span>{isAr ? 'إيقاف' : 'Pause'}</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 text-[#68A899]" />
                            <span>{isAr ? 'تشغيل المسار' : 'Simulate Flow'}</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsPlayingPassport(false);
                          setActiveStage(1);
                          setChainVerified(false);
                        }}
                        aria-label={isAr ? 'إعادة ضبط المراحل' : 'Reset stage walkthrough'}
                        className="rounded-lg bg-white/6 hover:bg-white/14 p-1.5 text-[#CBD2D3] hover:text-white transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Lot Header + Live Updating QR */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 pb-5 border-b border-white/10">
                    <div className="space-y-1.5 min-w-0">
                      <p className="font-mono text-xs text-[#C4A87E] tabular-nums">
                        {currentLot.code} · {isAr ? currentLot.corridorAr : currentLot.corridorEn}
                      </p>
                      <h4 className="text-lg font-bold text-white">
                        {isAr ? currentLot.titleAr : currentLot.titleEn}
                      </h4>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#CBD2D3]">
                        <span>{isAr ? currentLot.generatorAr : currentLot.generatorEn}</span>
                        <span className="text-white/25">·</span>
                        <span>{isAr ? currentLot.carrierAr : currentLot.carrierEn}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="bg-white p-2 rounded-xl shadow-sm">
                        <QRCodeSVG
                          value={`https://ouro.eco/verify/${currentLot.code}?stage=${selectedStage.code}`}
                          size={76}
                          bgColor="#FFFFFF"
                          fgColor="#1C2325"
                          level="M"
                          title={`Illustrative OURO Digital Waste Passport QR for ${currentLot.code}`}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Progress Track + Interactive 7-Stage Buttons */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[#CBD2D3]">
                        {isAr
                          ? 'مسار الحيازة (7 مراحل) — انقر لأي مرحلة'
                          : '7-Stage Chain of Custody — Click any stage'}
                      </span>
                      <span className="font-mono text-[#68A899] tabular-nums">
                        {selectedStage.step} / 7 · {selectedStage.code}
                      </span>
                    </div>

                    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-[#3D7568]"
                        animate={{ width: `${(activeStage / 7) * 100}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>

                    <div
                      role="tablist"
                      aria-label={isAr ? 'مراحل جواز المخلفات' : 'Digital Waste Passport Stages'}
                      className="grid grid-cols-4 sm:grid-cols-7 gap-1.5"
                    >
                      {PASSPORT_STAGES.map((stage) => {
                        const isSelected = stage.step === activeStage;
                        const isCompleted = stage.step <= activeStage;
                        return (
                          <button
                            key={stage.code}
                            type="button"
                            role="tab"
                            aria-selected={isSelected}
                            onClick={() => {
                              setIsPlayingPassport(false);
                              setActiveStage(stage.step);
                              setChainVerified(false);
                            }}
                            className={`px-2 py-2 rounded-lg text-center transition-colors border focus:outline-none focus-visible:ring-2 focus-visible:ring-[#68A899] ${
                              isSelected
                                ? 'bg-[#3D7568] border-[#68A899] text-white'
                                : isCompleted
                                ? 'bg-white/8 border-white/15 text-[#E2E7E7] hover:bg-white/14'
                                : 'bg-[#151B1D] border-white/8 text-[#8D999B] hover:text-white'
                            }`}
                          >
                            <span className="block font-mono text-[10px] font-bold tabular-nums opacity-80">
                              0{stage.step}
                            </span>
                            <span className="block text-[11px] font-semibold truncate mt-0.5">
                              {isAr ? stage.labelAr : stage.labelEn}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Animated Active Stage Detail + Interactive Hash Chain Check */}
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={`${currentLot.code}-${selectedStage.step}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                      className="rounded-xl bg-[#242D2F] border border-white/10 p-4 space-y-3.5 text-xs"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <p className="text-[#9EA3A4] font-medium">
                            {isAr ? 'الجهة المسؤولة' : 'Custody Role'}
                          </p>
                          <p className="mt-1 font-semibold text-white">
                            {isAr ? selectedStage.actorAr : selectedStage.actorEn}
                          </p>
                        </div>
                        <div>
                          <p className="text-[#9EA3A4] font-medium">
                            {isAr ? 'المستندات الداعمة' : 'Recorded Documentation'}
                          </p>
                          <p className="mt-1 text-[#E2E7E7] leading-snug">
                            {isAr ? selectedStage.evidenceAr : selectedStage.evidenceEn}
                          </p>
                        </div>
                        <div>
                          <p className="text-[#9EA3A4] font-medium">
                            {isAr ? 'توقيع السجل (SHA-256)' : 'Sample Event Hash'}
                          </p>
                          <p className="mt-1 font-mono text-[#68A899] tabular-nums">
                            sha256:{currentLot.hashPrefix}
                            {selectedStage.hashSuffix}
                          </p>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={activeStage <= 1}
                            onClick={() => {
                              setIsPlayingPassport(false);
                              setActiveStage((s) => Math.max(1, s - 1));
                            }}
                            className="rounded-md bg-white/8 hover:bg-white/15 disabled:opacity-35 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
                          >
                            {isAr ? 'المرحلة السابقة' : 'Prev Stage'}
                          </button>
                          <button
                            type="button"
                            disabled={activeStage >= 7}
                            onClick={() => {
                              setIsPlayingPassport(false);
                              setActiveStage((s) => Math.min(7, s + 1));
                            }}
                            className="rounded-md bg-white/8 hover:bg-white/15 disabled:opacity-35 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
                          >
                            {isAr ? 'المرحلة التالية' : 'Next Stage'}
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => setChainVerified(true)}
                          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-semibold transition-colors ${
                            chainVerified
                              ? 'bg-[#3D7568]/30 text-[#68A899] border border-[#68A899]/40'
                              : 'bg-[#A88B64]/20 hover:bg-[#A88B64]/30 text-[#C4A87E]'
                          }`}
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>
                            {chainVerified
                              ? isAr
                                ? `تم التحقق: ${activeStage} مراحل متصلة (SHA-256)`
                                : `Verified: ${activeStage}/${activeStage} Stages Hash-Linked`
                              : isAr
                              ? 'فحص سلامة سلسلة SHA-256'
                              : 'Verify SHA-256 Chain'}
                          </span>
                        </button>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.article>
        )}

        {/* ===================================================================
            02 — WASTE MARKET INTELLIGENCE (Preview Left / Text Right)
        =================================================================== */}
        {showLayer(1) && (
          <motion.article
            id="tech-layer-02"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.12 }}
            transition={REVEAL_TRANSITION}
            className="scroll-mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center"
          >
            {/* Interactive Market Dashboard (Left on Desktop) */}
            <div className="lg:col-span-7 order-2 lg:order-1">
              <div className="rounded-2xl bg-white border border-[#D4DDDD] shadow-lg overflow-hidden">
                <div className="px-5 py-3.5 bg-[#272F31] text-[#FBFCFD] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Database className="w-4 h-4 text-[#C4A87E]" />
                    <span className="text-xs font-bold tracking-wide">
                      {isAr ? 'لوحة ذكاء سوق المخلفات' : 'Interactive Market Intelligence Index'}
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-[#C4A87E]">
                    {isAr
                      ? 'معاينة تفاعلية توضيحية · مؤشرات نموذجية'
                      : 'Interactive Product Preview · Sample Index'}
                  </span>
                </div>

                {/* Multi-Axis Filters (Material + Availability + Sort) */}
                <div className="px-5 py-3.5 border-b border-[#E6ECEC] space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div
                      role="tablist"
                      aria-label={isAr ? 'تصفية فئات الخامات' : 'Filter material categories'}
                      className="flex flex-wrap gap-1.5"
                    >
                      {(
                        [
                          { id: 'all', en: 'All Streams', ar: 'جميع الخامات' },
                          { id: 'paper', en: 'Paper & OCC', ar: 'الورق والكرتون' },
                          { id: 'plastics', en: 'Plastics', ar: 'البلاستيك' },
                          { id: 'metals', en: 'Metals', ar: 'المعادن' },
                          { id: 'glass', en: 'Glass', ar: 'الزجاج' },
                        ] as Array<{ id: MaterialFilter; en: string; ar: string }>
                      ).map((tab) => {
                        const active = materialFilter === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setMaterialFilter(tab.id)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                              active
                                ? 'bg-[#272F31] text-white'
                                : 'bg-[#F0F3F3] text-[#4A5558] hover:bg-[#E2E8E8] hover:text-[#1C2325]'
                            }`}
                          >
                            {isAr ? tab.ar : tab.en}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        aria-label={isAr ? 'تصفية حسب الإتاحة' : 'Filter by availability'}
                        value={availabilityFilter}
                        onChange={(e) => setAvailabilityFilter(e.target.value as AvailabilityFilter)}
                        className="rounded-lg border border-[#D4DDDD] bg-[#F9FAFA] px-2.5 py-1.5 text-xs font-medium text-[#272F31] focus:border-[#3D7568] focus:outline-none"
                      >
                        <option value="all">{isAr ? 'كل مستويات الإتاحة' : 'All Availability'}</option>
                        <option value="high">{isAr ? 'متاح بوفرة' : 'High Only'}</option>
                        <option value="moderate">{isAr ? 'متوسط' : 'Moderate Only'}</option>
                        <option value="tight">{isAr ? 'معروض محدود' : 'Tight Only'}</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => setSortByAvailabilityDesc((v) => !v)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#D4DDDD] bg-[#F9FAFA] hover:bg-[#EDF1F1] px-2.5 py-1.5 text-xs font-semibold text-[#272F31] transition-colors whitespace-nowrap"
                      >
                        <ArrowUpDown className="w-3.5 h-3.5 text-[#3D7568]" />
                        <span>{isAr ? 'ترتيب' : 'Sort'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Clickable Market Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-start border-collapse">
                    <thead>
                      <tr className="border-b border-[#E6ECEC] bg-[#F9FAFA] text-[11px] font-semibold uppercase tracking-wide text-[#627073]">
                        <th className="py-3 px-5 text-start">
                          {isAr ? 'الخامة والدرجة' : 'Material & Grade'}
                        </th>
                        <th className="py-3 px-4 text-start">
                          {isAr ? 'النطاق الإقليمي' : 'Regional Corridor'}
                        </th>
                        <th className="py-3 px-4 text-start">
                          {isAr ? 'الإتاحة' : 'Availability'}
                        </th>
                        <th className="py-3 px-5 text-start">
                          {isAr ? 'اتجاه المؤشر' : 'Index Trend'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EDF1F1] text-xs">
                      {filteredMarketRows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-6 px-5 text-center text-[#627073]">
                            {isAr
                              ? 'لا توجد مسارات نموذجية مطابقة لهذا التصفية — جرّب اختيار "جميع الخامات".'
                              : 'No sample streams match this filter combination — reset availability or category.'}
                          </td>
                        </tr>
                      ) : (
                        filteredMarketRows.map((row) => {
                          const isSelected = row.id === inspectedMarketRow.id;
                          return (
                            <tr
                              key={row.id}
                              onClick={() => setSelectedMarketRowId(row.id)}
                              className={`cursor-pointer transition-colors ${
                                isSelected ? 'bg-[#EEF5F3]' : 'hover:bg-[#F7F9F9]'
                              }`}
                            >
                              <td className="py-3.5 px-5">
                                <p className="font-bold text-[#1C2325]">
                                  {isAr ? row.materialAr : row.materialEn}
                                </p>
                                <p className="text-[11px] text-[#627073] font-mono mt-0.5">
                                  {row.grade}
                                </p>
                              </td>
                              <td className="py-3.5 px-4 text-[#3A4548]">
                                <p className="font-medium">
                                  {isAr ? row.corridorAr : row.corridorEn}
                                </p>
                                <p className="text-[11px] text-[#6E7C7F] mt-0.5">
                                  {isAr ? row.cadenceAr : row.cadenceEn}
                                </p>
                              </td>
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                <span
                                  className={`font-semibold ${
                                    row.availability === 'high'
                                      ? 'text-[#3D7568]'
                                      : row.availability === 'tight'
                                      ? 'text-[#826946]'
                                      : 'text-[#4A5558]'
                                  }`}
                                >
                                  {row.availability === 'high'
                                    ? isAr
                                      ? 'متاح بوفرة'
                                      : 'High'
                                    : row.availability === 'tight'
                                    ? isAr
                                      ? 'معروض محدود'
                                      : 'Tight'
                                    : isAr
                                    ? 'متوسط'
                                    : 'Moderate'}
                                </span>
                              </td>
                              <td className="py-3.5 px-5 whitespace-nowrap">
                                <div className="flex items-center gap-3">
                                  <svg
                                    width="72"
                                    height="20"
                                    viewBox="0 0 72 20"
                                    className="shrink-0 overflow-visible"
                                    aria-hidden="true"
                                  >
                                    <polyline
                                      fill="none"
                                      stroke={
                                        row.direction === 'up'
                                          ? '#3D7568'
                                          : row.direction === 'soft'
                                          ? '#A88B64'
                                          : '#627073'
                                      }
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      points={row.sparkline}
                                    />
                                  </svg>
                                  <span className="inline-flex items-center gap-1 font-medium text-[#272F31]">
                                    {row.direction === 'up' ? (
                                      <TrendingUp className="w-3.5 h-3.5 text-[#3D7568]" />
                                    ) : row.direction === 'soft' ? (
                                      <TrendingDown className="w-3.5 h-3.5 text-[#A88B64]" />
                                    ) : (
                                      <Minus className="w-3.5 h-3.5 text-[#627073]" />
                                    )}
                                    <span>
                                      {row.direction === 'up'
                                        ? isAr
                                          ? 'صاعد'
                                          : 'Firming'
                                        : row.direction === 'soft'
                                        ? isAr
                                          ? 'هادئ'
                                          : 'Softening'
                                        : isAr
                                        ? 'مستقر'
                                        : 'Steady'}
                                    </span>
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Interactive Selected Stream Inspector Drawer */}
                <div className="px-5 py-4 bg-[#F6F9F8] border-t border-[#DCE5E3] text-xs space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-[#1C2325]">
                      {isAr ? 'تفاصيل المسار المختار:' : 'Selected Stream Specification:'}{' '}
                      <span className="text-[#3D7568]">
                        {isAr ? inspectedMarketRow.materialAr : inspectedMarketRow.materialEn}
                      </span>
                    </span>
                    <span className="text-[11px] text-[#627073]">
                      {isAr ? 'انقر على أي صف بالجدول للمعاينة' : 'Click any row above to inspect'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px] text-[#4A5558]">
                    <div>
                      <p className="font-semibold text-[#1C2325]">
                        {isAr ? 'التعبئة القياسية' : 'Standard Format'}
                      </p>
                      <p className="mt-0.5">
                        {isAr ? inspectedMarketRow.packagingAr : inspectedMarketRow.packagingEn}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-[#1C2325]">
                        {isAr ? 'النقل المعتمد (3PL)' : '3PL Fleet Class'}
                      </p>
                      <p className="mt-0.5">
                        {isAr ? inspectedMarketRow.vehicleAr : inspectedMarketRow.vehicleEn}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-[#1C2325]">
                        {isAr ? 'معيار الجودة' : 'Quality Specification'}
                      </p>
                      <p className="mt-0.5">
                        {isAr ? inspectedMarketRow.specNoteAr : inspectedMarketRow.specNoteEn}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Text Column (Right on Desktop) */}
            <div className="lg:col-span-5 order-1 lg:order-2 space-y-5">
              <div className="flex items-center gap-3 text-sm font-mono font-bold text-[#3D7568] tabular-nums">
                <span>02</span>
                <span className="h-px w-8 bg-[#A88B64]" aria-hidden="true" />
                <span className="font-sans text-xs font-semibold uppercase tracking-wider text-[#627073]">
                  {isAr ? 'قاعدة بيانات السوق' : 'Centralized Market Ledger'}
                </span>
              </div>

              <h3 className="text-2xl sm:text-3xl font-extrabold text-[#1C2325] leading-tight [text-wrap:balance]">
                {isAr ? 'ذكاء سوق المخلفات' : 'Waste Market Intelligence'}
              </h3>

              <p className="text-sm sm:text-base text-[#4A5558] leading-relaxed">
                {isAr
                  ? 'قاعدة بيانات مركزية لخامات المخلفات القابلة لإعادة التدوير، والكميات، ومستويات الإتاحة، والمعاملات، واتجاهات الأسعار، والمواقع الجغرافية، والنشاط التاريخي للسوق.'
                  : 'A centralized database of waste materials, quantities, availability, transactions, prices, locations, and historical market activity.'}
              </p>

              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-[#DCE2E2] text-sm">
                <div>
                  <p className="font-bold text-[#1C2325]">
                    {isAr ? 'تصنيف معياري للخامات' : 'Standardized Taxonomy'}
                  </p>
                  <p className="text-xs text-[#546164] mt-1 leading-relaxed">
                    {isAr
                      ? 'هيكل موحد للدرجات والجودة ومواصفات التعبئة لكل خامة صناعية.'
                      : 'Consistent material grades, baling formats, and contamination specs.'}
                  </p>
                </div>
                <div>
                  <p className="font-bold text-[#1C2325]">
                    {isAr ? 'رؤية جغرافية للمحاور' : 'Regional Corridor Depth'}
                  </p>
                  <p className="text-xs text-[#546164] mt-1 leading-relaxed">
                    {isAr
                      ? 'متابعة المعروض والنشاط عبر المناطق الصناعية الكبرى والمحافظات.'
                      : 'Filter and inspect regional supply conditions across industrial zones.'}
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => triggerRoleAction('factory_procurement', 'login')}
                  className="inline-flex items-center gap-2 text-sm font-bold text-[#3D7568] hover:text-[#1C2325] transition-colors whitespace-nowrap"
                >
                  <span>
                    {isAr ? 'استكشاف بوابة مشتريات المصانع' : 'Explore Factory Procurement Access'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.article>
        )}

        {/* ===================================================================
            03 — PREDICTIVE DEMAND & SUPPLY ANALYTICS (Text Left / Preview Right)
        =================================================================== */}
        {showLayer(2) && (
          <motion.article
            id="tech-layer-03"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.12 }}
            transition={REVEAL_TRANSITION}
            className="scroll-mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center"
          >
            {/* Text Column (Left) */}
            <div className="lg:col-span-5 space-y-5">
              <div className="flex items-center gap-3 text-sm font-mono font-bold text-[#3D7568] tabular-nums">
                <span>03</span>
                <span className="h-px w-8 bg-[#A88B64]" aria-hidden="true" />
                <span className="font-sans text-xs font-semibold uppercase tracking-wider text-[#627073]">
                  {isAr ? 'الاستشراف والتخطيط المسبق' : 'Forward Supply & Demand'}
                </span>
              </div>

              <h3 className="text-2xl sm:text-3xl font-extrabold text-[#1C2325] leading-tight [text-wrap:balance]">
                {isAr
                  ? 'التحليلات التنبؤية للعرض والطلب'
                  : 'Predictive Demand & Supply Analytics'}
              </h3>

              <p className="text-sm sm:text-base text-[#4A5558] leading-relaxed">
                {isAr
                  ? 'تحليل بيانات السوق التاريخية لتوقع الطلب على الخامات، ومستويات الإتاحة المستقبلية، ونقص المعروض الإقليمي، والفوائض المحتملة.'
                  : 'Analyze historical market data to forecast material demand, future availability, regional shortages, and potential supply surpluses.'}
              </p>

              <ul className="space-y-2.5 pt-3 border-t border-[#DCE2E2] text-sm text-[#272F31]">
                <li className="flex items-start gap-2.5">
                  <LineChart className="w-4 h-4 text-[#3D7568] shrink-0 mt-0.5" />
                  <span>
                    {isAr
                      ? 'بدّل بين الخامات والآفاق الزمنية وانقر على أي نقطة زمنية بالمخطط'
                      : 'Switch material streams, forecast horizons, and inspect any period point'}
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Layers className="w-4 h-4 text-[#3D7568] shrink-0 mt-0.5" />
                  <span>
                    {isAr
                      ? 'مؤشرات مبكرة للفجوة بين المعروض الإقليمي وطاقة المصانع الاستيعابية'
                      : 'Early directional signals highlighting tightening or surplus corridors'}
                  </span>
                </li>
              </ul>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => triggerRoleAction('factory_procurement', 'register')}
                  className="inline-flex items-center gap-2 text-sm font-bold text-[#3D7568] hover:text-[#1C2325] transition-colors whitespace-nowrap"
                >
                  <span>
                    {isAr ? 'تأهيل مصنعك لمنصة التحليلات' : 'Onboard Your Facility for Market Visibility'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Interactive Forecast Workspace (Right) */}
            <div className="lg:col-span-7">
              <div className="rounded-2xl bg-[#1C2325] text-[#FBFCFD] border border-[#A88B64]/25 shadow-xl overflow-hidden">
                <div className="px-5 py-3.5 bg-[#151B1D] border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <LineChart className="w-4 h-4 text-[#68A899]" />
                    <span className="text-xs font-bold tracking-wide">
                      {isAr
                        ? 'مساحة التحليلات التنبؤية للعرض والطلب'
                        : 'Interactive Supply & Demand Forecast'}
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-[#C4A87E]">
                    {isAr
                      ? 'معاينة تفاعلية توضيحية · مؤشر نسبي'
                      : 'Interactive Product Preview · Relative Index'}
                  </span>
                </div>

                <div className="p-5 sm:p-6 space-y-4">
                  {/* Horizon + Stream Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div
                      role="tablist"
                      aria-label={isAr ? 'الأفق الزمني للتوقع' : 'Forecast horizon'}
                      className="inline-flex rounded-lg bg-white/8 p-1 gap-1"
                    >
                      {(
                        [
                          { id: '30d', en: '30-Day', ar: '30 يوماً' },
                          { id: '90d', en: '90-Day', ar: '90 يوماً' },
                          { id: 'seasonal', en: 'Seasonal', ar: 'موسمي' },
                        ] as Array<{ id: ForecastHorizon; en: string; ar: string }>
                      ).map((h) => (
                        <button
                          key={h.id}
                          type="button"
                          role="tab"
                          aria-selected={forecastHorizon === h.id}
                          onClick={() => setForecastHorizon(h.id)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                            forecastHorizon === h.id
                              ? 'bg-[#3D7568] text-white'
                              : 'text-[#CBD2D3] hover:text-white'
                          }`}
                        >
                          {isAr ? h.ar : h.en}
                        </button>
                      ))}
                    </div>

                    <div
                      role="group"
                      aria-label={isAr ? 'فئة الخامة في التوقع' : 'Forecast material stream'}
                      className="flex flex-wrap gap-1"
                    >
                      {(
                        [
                          { id: 'all', en: 'All', ar: 'الكل' },
                          { id: 'paper', en: 'OCC', ar: 'كرتون' },
                          { id: 'plastics', en: 'PET/HDPE', ar: 'بلاستيك' },
                          { id: 'metals', en: 'Metals', ar: 'معادن' },
                        ] as Array<{ id: ForecastStream; en: string; ar: string }>
                      ).map((stream) => (
                        <button
                          key={stream.id}
                          type="button"
                          onClick={() => setForecastStream(stream.id)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                            forecastStream === stream.id
                              ? 'bg-[#A88B64] text-[#151B1D]'
                              : 'bg-white/6 text-[#CBD2D3] hover:bg-white/12'
                          }`}
                        >
                          {isAr ? stream.ar : stream.en}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Interactive Scrubber SVG Chart */}
                  <div className="rounded-xl bg-[#151B1D] border border-white/8 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8E9B9D] mb-2">
                      <div className="flex items-center gap-4">
                        <span className="inline-flex items-center gap-1.5 text-[#CBD2D3]">
                          <span className="w-3 h-0.5 bg-[#68A899] inline-block" />
                          {isAr ? 'العرض' : 'Supply'}
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[#CBD2D3]">
                          <span className="w-3 h-0.5 bg-[#C4A87E] inline-block" />
                          {isAr ? 'الطلب' : 'Demand'}
                        </span>
                      </div>
                      <span className="text-[#C4A87E]">
                        {isAr
                          ? 'مرّر أو انقر على أي فترة زمنية للفحص'
                          : 'Hover or click any time period to inspect'}
                      </span>
                    </div>

                    <svg
                      viewBox="0 0 490 170"
                      className="w-full h-44 sm:h-48 overflow-visible"
                      role="img"
                      aria-label={
                        isAr
                          ? 'مخطط تفاعلي توضيحي لمنحنيات العرض والطلب المستقبلية'
                          : 'Interactive illustrative chart comparing historical supply with projected supply and demand curves'
                      }
                    >
                      {[30, 70, 110, 145].map((y) => (
                        <line
                          key={y}
                          x1="20"
                          y1={y}
                          x2="472"
                          y2={y}
                          stroke="rgba(255,255,255,0.07)"
                          strokeWidth="1"
                        />
                      ))}

                      {/* Present Divider */}
                      <line
                        x1="212"
                        y1="18"
                        x2="212"
                        y2="148"
                        stroke="rgba(196,168,126,0.35)"
                        strokeWidth="1"
                        strokeDasharray="4 4"
                      />

                      {/* Projected Envelope */}
                      <polygon points={projBandPolygon} fill="rgba(104, 168, 153, 0.14)" />

                      {/* Curves */}
                      <polyline
                        fill="none"
                        stroke="#68A899"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={histSupplyPolyline}
                      />
                      <polyline
                        fill="none"
                        stroke="#68A899"
                        strokeWidth="2.5"
                        strokeDasharray="6 4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={projSupplyPolyline}
                      />
                      <polyline
                        fill="none"
                        stroke="#C4A87E"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={demandPolyline}
                      />

                      {/* Active Period Crosshair */}
                      <line
                        x1={20 + clampedPeriodIdx * 64}
                        y1="18"
                        x2={20 + clampedPeriodIdx * 64}
                        y2="148"
                        stroke="rgba(255,255,255,0.28)"
                        strokeWidth="1"
                      />

                      {/* Interactive Hit Zones & Nodes */}
                      {forecastPoints.map((pt, idx) => {
                        const x = 20 + idx * 64;
                        const active = idx === clampedPeriodIdx;
                        return (
                          <g
                            key={`${pt.labelEn}-${idx}`}
                            className="cursor-pointer"
                            onMouseEnter={() => setSelectedPeriodIdx(idx)}
                            onClick={() => setSelectedPeriodIdx(idx)}
                          >
                            <rect
                              x={x - 28}
                              y="16"
                              width="56"
                              height="150"
                              fill="transparent"
                            />
                            <circle
                              cx={x}
                              cy={pt.supplyY}
                              r={active ? 5.5 : 3}
                              fill="#68A899"
                              stroke="#151B1D"
                              strokeWidth="2"
                            />
                            <circle
                              cx={x}
                              cy={pt.demandY}
                              r={active ? 5.5 : 3}
                              fill="#C4A87E"
                              stroke="#151B1D"
                              strokeWidth="2"
                            />
                            <text
                              x={x}
                              y="164"
                              textAnchor="middle"
                              fill={active ? '#FFFFFF' : idx === 3 ? '#C4A87E' : '#8E9B9D'}
                              fontWeight={active ? '700' : '400'}
                              fontSize="10"
                              fontFamily="JetBrains Mono, monospace"
                            >
                              {isAr ? pt.labelAr : pt.labelEn}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* Interactive Period Readout Bar */}
                  <div className="rounded-xl bg-[#242D2F] border border-white/10 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <p className="text-[11px] text-[#9EA3A4]">
                        {isAr ? 'الفترة المحددة' : 'Inspected Period'}
                      </p>
                      <p className="mt-1 font-mono font-bold text-white">
                        {isAr ? inspectedPeriod.labelAr : inspectedPeriod.labelEn} ·{' '}
                        {inspectedPeriod.projected
                          ? isAr
                            ? 'توقع إرشادي'
                            : 'Projected'
                          : isAr
                          ? 'مرصود تاريخياً'
                          : 'Historical'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#9EA3A4]">
                        {isAr ? 'إشارة توازن السوق' : 'Directional Balance'}
                      </p>
                      <p className={`mt-1 font-bold ${periodStatus.tone}`}>
                        {isAr ? periodStatus.ar : periodStatus.en}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#9EA3A4]">
                        {isAr ? 'التوصية التشغيلية' : 'Planning Posture'}
                      </p>
                      <p className="mt-1 text-[#E2E7E7]">
                        {periodGap < -6
                          ? isAr
                            ? 'تأمين عقود الحجز مبكراً'
                            : 'Lock supply reservations early'
                          : periodGap > 6
                          ? isAr
                            ? 'فرصة تجميع مخزون احتياطي'
                            : 'Favorable buffer-building window'
                          : isAr
                          ? 'وتيرة شراء وتوريد اعتيادية'
                          : 'Maintain standard procurement cadence'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.article>
        )}

        {/* ===================================================================
            04 — INDUSTRIAL DECISION INTELLIGENCE (Preview Left / Text Right)
        =================================================================== */}
        {showLayer(3) && (
          <motion.article
            id="tech-layer-04"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.12 }}
            transition={REVEAL_TRANSITION}
            className="scroll-mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center"
          >
            {/* Interactive Decision Workspace (Left on Desktop) */}
            <div className="lg:col-span-7 order-2 lg:order-1">
              <div className="rounded-2xl bg-white border border-[#D4DDDD] shadow-lg overflow-hidden">
                <div className="px-5 py-3.5 bg-[#272F31] text-[#FBFCFD] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <SlidersHorizontal className="w-4 h-4 text-[#C4A87E]" />
                    <span className="text-xs font-bold tracking-wide">
                      {isAr
                        ? 'مساحة ذكاء القرار الصناعي التفاعلية'
                        : 'Interactive Industrial Decision Workspace'}
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-[#C4A87E]">
                    {isAr
                      ? 'معاينة تفاعلية توضيحية · سير عمل نموذجي'
                      : 'Interactive Product Preview · Sample Workflow'}
                  </span>
                </div>

                {/* Mode Switcher */}
                <div className="px-5 pt-4 pb-3 border-b border-[#E6ECEC] flex flex-wrap items-center justify-between gap-3">
                  <div
                    role="tablist"
                    aria-label={isAr ? 'أوضاع القرار الصناعي' : 'Industrial decision modes'}
                    className="flex flex-wrap gap-1.5"
                  >
                    {(
                      [
                        { id: 'matching', en: 'Supplier Matching', ar: 'مطابقة الموردين' },
                        { id: 'inventory', en: 'Inventory Planning', ar: 'تخطيط المخزون' },
                        { id: 'sales', en: 'Waste Sales Timing', ar: 'توقيت بيع الخامات' },
                      ] as Array<{ id: DecisionMode; en: string; ar: string }>
                    ).map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        role="tab"
                        aria-selected={decisionMode === mode.id}
                        onClick={() => setDecisionMode(mode.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                          decisionMode === mode.id
                            ? 'bg-[#272F31] text-white'
                            : 'bg-[#F0F3F3] text-[#4A5558] hover:bg-[#E2E8E8] hover:text-[#1C2325]'
                        }`}
                      >
                        {isAr ? mode.ar : mode.en}
                      </button>
                    ))}
                  </div>

                  {decisionMode === 'matching' && (
                    <span className="text-[11px] font-mono text-[#3D7568] tabular-nums">
                      {reservedSampleLots.length}{' '}
                      {isAr ? 'محجوز بالمعاينة' : 'sample held'}
                    </span>
                  )}
                </div>

                <div className="p-5 sm:p-6 space-y-4 text-xs">
                  {decisionMode === 'matching' && (
                    <>
                      {/* Priority Re-Ranking Controls */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                        <span className="font-semibold text-[#4A5558]">
                          {isAr ? 'أولوية الترتيب الذكي:' : 'Rank Sample Lots By:'}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {(
                            [
                              { id: 'purity', en: 'Material Purity', ar: 'نقاء الخامة' },
                              { id: 'proximity', en: 'Corridor Distance', ar: 'قرب المسار' },
                              { id: 'pickup', en: '3PL Readiness', ar: 'سرعة الاستلام' },
                            ] as Array<{ id: MatchPriority; en: string; ar: string }>
                          ).map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setMatchPriority(p.id)}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                                matchPriority === p.id
                                  ? 'bg-[#3D7568] text-white'
                                  : 'bg-[#F0F3F3] text-[#4A5558] hover:bg-[#E2E8E8]'
                              }`}
                            >
                              {isAr ? p.ar : p.en}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        {rankedDecisionLots.map((lot, rankIdx) => {
                          const isReserved = reservedSampleLots.includes(lot.id);
                          return (
                            <motion.div
                              key={lot.id}
                              layout
                              transition={{ duration: 0.25 }}
                              className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                                isReserved
                                  ? 'bg-[#EEF5F3] border-[#3D7568]/50'
                                  : 'bg-[#F8FAFA] border-[#E2E8E8]'
                              }`}
                            >
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[11px] font-bold text-[#826946] tabular-nums">
                                    #0{rankIdx + 1}
                                  </span>
                                  <p className="font-bold text-[#1C2325] truncate">
                                    {isAr ? lot.titleAr : lot.titleEn}
                                  </p>
                                </div>
                                <p className="text-[#546164]">
                                  {isAr ? lot.subtitleAr : lot.subtitleEn}
                                </p>
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                <span className="font-mono text-[11px] font-bold text-[#3D7568] whitespace-nowrap">
                                  {isAr ? lot.badgeAr : lot.badgeEn}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => toggleSampleReserve(lot.id)}
                                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap ${
                                    isReserved
                                      ? 'bg-[#272F31] text-white hover:bg-[#333D40]'
                                      : 'bg-white border border-[#C6D1D1] text-[#1C2325] hover:border-[#3D7568]'
                                  }`}
                                >
                                  {isReserved
                                    ? isAr
                                      ? 'إلغاء الحجز التجريبي'
                                      : 'Release Sample'
                                    : isAr
                                    ? 'حجز تجريبي'
                                    : 'Hold Sample'}
                                </button>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {decisionMode === 'inventory' && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-[#4A5558]">
                          {isAr ? 'معدل تشغيل خطوط المصنع:' : 'Simulate Mill Intake Rate:'}
                        </span>
                        <div className="inline-flex rounded-lg bg-[#F0F3F3] p-1 gap-1">
                          {(
                            [
                              { id: 'low', en: 'Low Run', ar: 'تشغيل هادئ' },
                              { id: 'standard', en: 'Standard', ar: 'معتاد' },
                              { id: 'peak', en: 'Peak Run', ar: 'ذروة التشغيل' },
                            ] as Array<{ id: RunRateLevel; en: string; ar: string }>
                          ).map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => setRunRate(r.id)}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                                runRate === r.id
                                  ? 'bg-[#272F31] text-white'
                                  : 'text-[#4A5558] hover:text-[#1C2325]'
                              }`}
                            >
                              {isAr ? r.ar : r.en}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {[
                          {
                            labelEn: 'Corrugated Cardboard (OCC)',
                            labelAr: 'كرتون مضلع (OCC)',
                            pctMap: { low: 88, standard: 76, peak: 52 },
                          },
                          {
                            labelEn: 'Clear PET Feedstock',
                            labelAr: 'خامة PET الشفافة',
                            pctMap: { low: 68, standard: 42, peak: 24 },
                          },
                          {
                            labelEn: 'Industrial HDPE Rigid',
                            labelAr: 'بلاستيك HDPE صلب',
                            pctMap: { low: 80, standard: 60, peak: 38 },
                          },
                        ].map((item) => {
                          const coverage = item.pctMap[runRate];
                          const status =
                            coverage >= 65
                              ? {
                                  en: 'Healthy Buffer · Standard Cadence',
                                  ar: 'مخزون آمن · وتيرة طبيعية',
                                  bar: 'bg-[#3D7568]',
                                }
                              : coverage >= 40
                              ? {
                                  en: 'Moderate Buffer · Schedule Reserve',
                                  ar: 'مخزون متوسط · جدولة حجز قريب',
                                  bar: 'bg-[#826946]',
                                }
                              : {
                                  en: 'Low Buffer · Immediate Sourcing Action',
                                  ar: 'مخزون منخفض · يتطلب حجزاً فورياً',
                                  bar: 'bg-[#A85A4B]',
                                };
                          return (
                            <div
                              key={item.labelEn}
                              className="rounded-xl bg-[#F8FAFA] border border-[#E2E8E8] p-4 space-y-2"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-bold text-[#1C2325]">
                                  {isAr ? item.labelAr : item.labelEn}
                                </span>
                                <span className="text-[11px] font-medium text-[#546164]">
                                  {isAr ? status.ar : status.en}
                                </span>
                              </div>
                              <div className="h-2 w-full rounded-full bg-[#E6ECEC] overflow-hidden">
                                <motion.div
                                  className={`h-full rounded-full ${status.bar}`}
                                  animate={{ width: `${coverage}%` }}
                                  transition={{ duration: 0.35 }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {decisionMode === 'sales' && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-[#4A5558]">
                          {isAr ? 'قارن استراتيجية الإدراج:' : 'Compare Generator Release Strategy:'}
                        </span>
                        <div className="inline-flex rounded-lg bg-[#F0F3F3] p-1 gap-1">
                          <button
                            type="button"
                            onClick={() => setConsolidatedBatch(false)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                              !consolidatedBatch
                                ? 'bg-[#272F31] text-white'
                                : 'text-[#4A5558] hover:text-[#1C2325]'
                            }`}
                          >
                            {isAr ? 'دفعات صغيرة متفرقة' : 'Ad-Hoc Small Lots'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConsolidatedBatch(true)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                              consolidatedBatch
                                ? 'bg-[#3D7568] text-white'
                                : 'text-[#4A5558] hover:text-[#1C2325]'
                            }`}
                          >
                            {isAr ? 'تجميع بالات بدرجة موحدة' : 'Consolidated Grade Bales'}
                          </button>
                        </div>
                      </div>

                      <div className="rounded-xl bg-[#F8FAFA] border border-[#E2E8E8] p-4 space-y-2">
                        <p className="font-bold text-[#1C2325]">
                          {consolidatedBatch
                            ? isAr
                              ? 'تجميع البالات الموحدة قبل الإدراج (إرشادي)'
                              : 'Consolidated Single-Grade Bales (Illustrative Outcome)'
                            : isAr
                            ? 'إدراج دفعات صغيرة مختلطة (إرشادي)'
                            : 'Fragmented Small-Lot Releases (Illustrative Outcome)'}
                        </p>
                        <p className="text-[#546164] leading-relaxed">
                          {consolidatedBatch
                            ? isAr
                              ? 'يرفع امتلاء شاحنات النقل المرخصة (3PL) ويقلل تكلفة النقل لكل طن ويزيد جاذبية التشغيلة لمصانع التدوير المباشرة.'
                              : 'Improves certified 3PL payload utilization, reduces unit haulage friction, and attracts direct industrial mill reservations.'
                            : isAr
                            ? 'يزيد عدد رحلات الاستلام الجزئية ويحدّ من تطابق التشغيلة مع المصانع الكبرى التي تتطلب درجات فرز موحدة.'
                            : 'Increases partial-load pickup trips and narrows matching to buyers equipped for mixed-grade re-sorting.'}
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="rounded-xl bg-[#F8FAFA] border border-[#E2E8E8] p-4">
                          <p className="text-[11px] text-[#627073]">
                            {isAr ? 'كفاءة حمولة النقل (3PL)' : '3PL Payload Utilization'}
                          </p>
                          <p
                            className={`mt-1 font-mono font-bold ${
                              consolidatedBatch ? 'text-[#3D7568]' : 'text-[#826946]'
                            }`}
                          >
                            {consolidatedBatch
                              ? isAr
                                ? 'عالية · حمولة كاملة'
                                : 'High · Full-Truck Eligible'
                              : isAr
                              ? 'جزئية · رحلات متكررة'
                              : 'Partial · Multi-Trip'}
                          </p>
                        </div>
                        <div className="rounded-xl bg-[#F8FAFA] border border-[#E2E8E8] p-4">
                          <p className="text-[11px] text-[#627073]">
                            {isAr ? 'مواءمة المشترين الصناعيين' : 'Direct Mill Buyer Fit'}
                          </p>
                          <p className="mt-1 font-semibold text-[#1C2325]">
                            {consolidatedBatch
                              ? isAr
                                ? 'مباشر · مطابق للمواصفة'
                                : 'Direct Mill Match'
                              : isAr
                              ? 'يتطلب فرزاً إضافياً'
                              : 'Requires Secondary Sorting'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Text Column (Right on Desktop) */}
            <div className="lg:col-span-5 order-1 lg:order-2 space-y-5">
              <div className="flex items-center gap-3 text-sm font-mono font-bold text-[#3D7568] tabular-nums">
                <span>04</span>
                <span className="h-px w-8 bg-[#A88B64]" aria-hidden="true" />
                <span className="font-sans text-xs font-semibold uppercase tracking-wider text-[#627073]">
                  {isAr ? 'دعم القرار الصناعي' : 'Procurement & Planning'}
                </span>
              </div>

              <h3 className="text-2xl sm:text-3xl font-extrabold text-[#1C2325] leading-tight [text-wrap:balance]">
                {isAr ? 'ذكاء القرار الصناعي' : 'Industrial Decision Intelligence'}
              </h3>

              <p className="text-sm sm:text-base text-[#4A5558] leading-relaxed">
                {isAr
                  ? 'مساعدة المصانع على تحسين قرارات المشتريات، وتخطيط المخزون، ومطابقة الموردين، وتوقيت بيع الخامات اعتماداً على ذكاء السوق.'
                  : 'Help factories optimize procurement, inventory planning, supplier matching, and waste sales decisions using market intelligence.'}
              </p>

              <ul className="space-y-2.5 pt-3 border-t border-[#DCE2E2] text-sm text-[#272F31]">
                <li className="flex items-start gap-2.5">
                  <Factory className="w-4 h-4 text-[#3D7568] shrink-0 mt-0.5" />
                  <span>
                    {isAr
                      ? 'جرّب إعادة ترتيب التشغيلات حسب النقاء أو القرب أو سرعة الاستلام'
                      : 'Re-rank matched generator lots by purity, proximity, or 3PL pickup readiness'}
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Scale className="w-4 h-4 text-[#3D7568] shrink-0 mt-0.5" />
                  <span>
                    {isAr
                      ? 'اختبر تأثير معدل تشغيل المصنع على تغطية المخزون وتوقيت البيع'
                      : 'Simulate mill intake run rates and compare batch consolidation strategies'}
                  </span>
                </li>
              </ul>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => triggerRoleAction('factory_procurement', 'login')}
                  className="inline-flex items-center gap-2 text-sm font-bold text-[#3D7568] hover:text-[#1C2325] transition-colors whitespace-nowrap"
                >
                  <span>
                    {isAr ? 'الدخول لبوابة المشتريات الصناعية' : 'Open Factory Procurement Workspace'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.article>
        )}

        {/* ===================================================================
            05 — VERIFIED ENVIRONMENTAL INTELLIGENCE (Text Left / Preview Right)
        =================================================================== */}
        {showLayer(4) && (
          <motion.article
            id="tech-layer-05"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.12 }}
            transition={REVEAL_TRANSITION}
            className="scroll-mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center"
          >
            {/* Text Column (Left) */}
            <div className="lg:col-span-5 space-y-5">
              <div className="flex items-center gap-3 text-sm font-mono font-bold text-[#3D7568] tabular-nums">
                <span>05</span>
                <span className="h-px w-8 bg-[#A88B64]" aria-hidden="true" />
                <span className="font-sans text-xs font-semibold uppercase tracking-wider text-[#627073]">
                  {isAr ? 'الاستدامة وتقارير ESG' : 'Auditable ESG & Carbon'}
                </span>
              </div>

              <h3 className="text-2xl sm:text-3xl font-extrabold text-[#1C2325] leading-tight [text-wrap:balance]">
                {isAr ? 'الذكاء البيئي الموثق' : 'Verified Environmental Intelligence'}
              </h3>

              <p className="text-sm sm:text-base text-[#4A5558] leading-relaxed">
                {isAr
                  ? 'تحويل سجلات الشحن وإعادة التدوير الموثقة إلى مؤشرات ESG قابلة للقياس، وتقارير بصمة كربونية، وأداء إعادة تدوير، وبيانات بيئية جاهزة للتدقيق.'
                  : 'Transform verified shipment and recycling records into measurable ESG indicators, carbon footprint reports, recycling performance, and auditable environmental data.'}
              </p>

              <ul className="space-y-2.5 pt-3 border-t border-[#DCE2E2] text-sm text-[#272F31]">
                <li className="flex items-start gap-2.5">
                  <Leaf className="w-4 h-4 text-[#3D7568] shrink-0 mt-0.5" />
                  <span>
                    {isAr
                      ? 'احتساب الأثر الكربوني حصرياً بعد إتمام المرحلة 7 وإثبات اتزان الكتلة'
                      : 'Carbon accounting unlocks strictly after Stage 7 mass-balance verification'}
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-[#3D7568] shrink-0 mt-0.5" />
                  <span>
                    {isAr
                      ? 'منهجية EPA WARM v16 / IPCC وتقارير قابلة للتصدير والتدقيق المؤسسي'
                      : 'Built on EPA WARM v16 / IPCC guidelines with SHA-256 audit export trails'}
                  </span>
                </li>
              </ul>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => triggerRoleAction('generator_ops', 'register')}
                  className="inline-flex items-center gap-2 text-sm font-bold text-[#3D7568] hover:text-[#1C2325] transition-colors whitespace-nowrap"
                >
                  <span>
                    {isAr ? 'تسجيل منشأة لتوثيق تقارير ESG' : 'Register Facility for Verified ESG Reporting'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Interactive ESG Gate & Mass-Balance Sandbox (Right) */}
            <div className="lg:col-span-7">
              <div className="rounded-2xl bg-[#1C2325] text-[#FBFCFD] border border-[#A88B64]/25 shadow-xl overflow-hidden">
                <div className="px-5 py-3.5 bg-[#151B1D] border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Leaf className="w-4 h-4 text-[#68A899]" />
                    <span className="text-xs font-bold tracking-wide">
                      {isAr
                        ? 'محاكي التحقق البيئي واتزان الكتلة (ESG)'
                        : 'Interactive ESG Verification & Mass-Balance Sandbox'}
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-[#C4A87E]">
                    {isAr
                      ? 'معاينة تفاعلية توضيحية · معادلة نموذجية'
                      : 'Interactive Product Preview · Formula Sandbox'}
                  </span>
                </div>

                <div className="p-5 sm:p-6 space-y-5">
                  {/* Verification Gate Switcher */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div
                      role="tablist"
                      aria-label={isAr ? 'بوابات التحقق البيئي' : 'ESG verification gate stages'}
                      className="inline-flex flex-wrap rounded-lg bg-white/8 p-1 gap-1"
                    >
                      {(
                        [
                          { id: 'listed', en: 'Stage 3 · Listed', ar: 'مرحلة 3 · معروض' },
                          { id: 'delivered', en: 'Stage 6 · Delivered', ar: 'مرحلة 6 · مُسلّم' },
                          { id: 'recycled', en: 'Stage 7 · Verified', ar: 'مرحلة 7 · موثق' },
                        ] as Array<{ id: VerificationGate; en: string; ar: string }>
                      ).map((gate) => (
                        <button
                          key={gate.id}
                          type="button"
                          role="tab"
                          aria-selected={verificationGate === gate.id}
                          onClick={() => setVerificationGate(gate.id)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                            verificationGate === gate.id
                              ? 'bg-[#3D7568] text-white'
                              : 'text-[#CBD2D3] hover:text-white'
                          }`}
                        >
                          {isAr ? gate.ar : gate.en}
                        </button>
                      ))}
                    </div>
                    <span className="font-mono text-[11px] text-[#68A899]">
                      {verificationGate === 'recycled'
                        ? isAr
                          ? 'مؤهل لتقارير ESG'
                          : 'ESG Ledger Unlocked'
                        : isAr
                        ? 'مغلق حتى التحقق'
                        : 'ESG Credit Locked'}
                    </span>
                  </div>

                  {/* Gate Status Description */}
                  <div className="rounded-xl bg-[#242D2F] border border-white/10 p-4 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-white text-sm">
                        {verificationGate === 'listed'
                          ? isAr
                            ? 'خامة مدرجة — مستبعدة من سجل الكربون الموثق'
                            : 'Listed Material — Excluded from Verified Carbon Ledger'
                          : verificationGate === 'delivered'
                          ? isAr
                            ? 'تم التسليم للمصنع — بانتظار إثبات اتزان الكتلة'
                            : 'Delivered to Facility — Awaiting Mass-Balance Proof'
                          : isAr
                            ? 'إعادة تدوير موثقة — معتمدة لتقارير ESG والتدقيق'
                            : 'Independently Verified — Eligible for Auditable ESG Reports'}
                      </span>
                      <CheckCircle2
                        className={`w-4 h-4 shrink-0 ${
                          verificationGate === 'recycled' ? 'text-[#68A899]' : 'text-[#8E9B9D]'
                        }`}
                      />
                    </div>
                    <p className="text-[#CBD2D3] leading-relaxed">
                      {verificationGate === 'listed'
                        ? isAr
                          ? 'تمنع OURO احتساب أي وفر كربوني أو معدل تدوير للخامات بمجرد عرضها في السوق لضمان عدم تضخيم مؤشرات الاستدامة.'
                          : 'OURO excludes listed or reserved tonnage from CO2e avoidance totals to prevent premature environmental claims.'
                        : verificationGate === 'delivered'
                        ? isAr
                          ? 'تُوثق الشحنة عبر إيصال الميزان عند الاستلام، وتظل قيد التحقق حتى توثيق الكمية المسترجعة فعلياً.'
                          : 'Inbound weighbridge tickets confirm receipt; environmental credits remain locked until recovery output is reconciled.'
                        : isAr
                          ? 'جرّب أدناه تعديل نسب الاسترجاع والفاقد لرؤية معادلة اتزان الكتلة التي تعتمدها المنصة قبل إصدار شهادة ESG.'
                          : 'Adjust the illustrative mass-balance sliders below to test how OURO reconciles recovered output, residual, and process loss.'}
                    </p>
                  </div>

                  {/* Interactive Mass-Balance Reconciliation Sliders */}
                  <div className="rounded-xl bg-[#151B1D] border border-white/10 p-4 space-y-4 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <label className="block space-y-1.5">
                        <span className="flex items-center justify-between text-[11px] text-[#CBD2D3]">
                          <span>{isAr ? 'الكمية المستلمة (وحدة نموذجية)' : 'Sample Delivered Mass'}</span>
                          <span className="font-mono font-bold text-white tabular-nums">
                            {sampleDeliveredUnits} u
                          </span>
                        </span>
                        <input
                          type="range"
                          min={20}
                          max={200}
                          step={10}
                          value={sampleDeliveredUnits}
                          onChange={(e) => setSampleDeliveredUnits(Number(e.target.value))}
                          className="w-full accent-[#3D7568] cursor-pointer"
                        />
                      </label>

                      <label className="block space-y-1.5">
                        <span className="flex items-center justify-between text-[11px] text-[#CBD2D3]">
                          <span>{isAr ? 'نسبة الاسترجاع' : 'Recovered Output'}</span>
                          <span className="font-mono font-bold text-[#68A899] tabular-nums">
                            {sampleRecoveryPct}%
                          </span>
                        </span>
                        <input
                          type="range"
                          min={60}
                          max={96}
                          step={2}
                          value={sampleRecoveryPct}
                          onChange={(e) => setSampleRecoveryPct(Number(e.target.value))}
                          className="w-full accent-[#3D7568] cursor-pointer"
                        />
                      </label>

                      <label className="block space-y-1.5">
                        <span className="flex items-center justify-between text-[11px] text-[#CBD2D3]">
                          <span>{isAr ? 'فاقد التشغيل' : 'Process Loss'}</span>
                          <span className="font-mono font-bold text-[#C4A87E] tabular-nums">
                            {safeLossPct}%
                          </span>
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={Math.min(15, 100 - sampleRecoveryPct)}
                          step={1}
                          value={safeLossPct}
                          onChange={(e) => setSampleProcessLossPct(Number(e.target.value))}
                          className="w-full accent-[#A88B64] cursor-pointer"
                        />
                      </label>
                    </div>

                    {/* Visual Mass-Balance Bar */}
                    <div className="space-y-2">
                      <div className="h-2.5 w-full rounded-full bg-white/10 overflow-hidden flex">
                        <div
                          className="h-full bg-[#3D7568] transition-all duration-200"
                          style={{ width: `${sampleRecoveryPct}%` }}
                        />
                        <div
                          className="h-full bg-[#627073] transition-all duration-200"
                          style={{ width: `${residualPct}%` }}
                        />
                        <div
                          className="h-full bg-[#A88B64] transition-all duration-200"
                          style={{ width: `${safeLossPct}%` }}
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] tabular-nums">
                        <span className="text-[#CBD2D3]">
                          {sampleDeliveredUnits}u ={' '}
                          <span className="text-[#68A899]">{recoveredUnits}u Rec</span> +{' '}
                          <span className="text-[#9EA3A4]">{residualUnits}u Res</span> +{' '}
                          <span className="text-[#C4A87E]">{lossUnits}u Loss</span>
                        </span>
                        <span className="text-[#68A899] font-semibold">
                          {reconciledSum === sampleDeliveredUnits
                            ? isAr
                              ? 'اتزان الكتلة مطابق (100%)'
                              : 'Mass Balance Reconciled'
                            : 'Check Balance'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Methodology & Deliverables Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl bg-[#151B1D] border border-white/8 p-3.5">
                      <p className="text-[11px] text-[#9EA3A4]">
                        {isAr ? 'المنهجية المرجعية' : 'Methodology Framework'}
                      </p>
                      <p className="mt-1 font-mono font-semibold text-[#68A899]">
                        EPA WARM v16 · IPCC
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#151B1D] border border-white/8 p-3.5">
                      <p className="text-[11px] text-[#9EA3A4]">
                        {isAr ? 'حزمة التصدير' : 'Audit Deliverables'}
                      </p>
                      <p className="mt-1 font-mono font-semibold text-[#C4A87E]">
                        ESG CSV · SHA-256 Trail
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.article>
        )}

        {/* ===================================================================
            CLOSING ENTERPRISE CONVERSION BAND
        =================================================================== */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={REVEAL_TRANSITION}
          className="rounded-2xl bg-[#272F31] text-[#FBFCFD] border border-[#A88B64]/25 p-7 sm:p-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6"
        >
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#C4A87E]">
              {isAr ? 'جاهز للانضمام إلى شبكة OURO' : 'Role-Isolated B2B Onboarding'}
            </p>
            <h3 className="text-xl sm:text-2xl font-extrabold text-white leading-snug [text-wrap:balance]">
              {isAr
                ? 'ابدأ إدارة وتوثيق سلاسل إمداد التدوير عبر منصة مؤسسية واحدة.'
                : 'Operate verified circular supply chains from a single enterprise workspace.'}
            </h3>
            <p className="text-sm text-[#CBD2D3]">
              {isAr
                ? 'اختر دورك التشغيلي للانتقال مباشرة إلى بوابة الدخول أو التسجيل الموثق أعلى الصفحة.'
                : 'Select your operational role to jump directly to sign-in or KYC onboarding in the access portal above.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => triggerRoleAction('generator_ops', 'register')}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#3D7568] hover:bg-[#488577] text-white text-sm font-bold transition-colors whitespace-nowrap"
            >
              {isAr ? 'تسجيل مولد مخلفات' : 'Register Waste Generator'}
            </button>
            <button
              type="button"
              onClick={() => triggerRoleAction('factory_procurement', 'register')}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-white hover:bg-[#EEF2F2] text-[#1C2325] text-sm font-bold transition-colors whitespace-nowrap"
            >
              {isAr ? 'تأهيل مصنع تدوير (KYC)' : 'Onboard Recycling Factory'}
            </button>
            <button
              type="button"
              onClick={() => triggerRoleAction('factory_procurement', 'login')}
              className="min-h-[44px] px-4 py-2.5 rounded-xl border border-white/20 hover:bg-white/10 text-[#FBFCFD] text-sm font-semibold transition-colors whitespace-nowrap"
            >
              {isAr ? 'تسجيل الدخول' : 'Sign In'}
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

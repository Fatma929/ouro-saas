export type UserRole = 'generator_ops' | 'factory_procurement' | 'driver_3pl' | 'platform_admin';

export type FacilityType =
  | 'factory'
  | 'company'
  | 'educational_institution'
  | 'service_institution'
  | 'hotel'
  | 'commercial';

export type HubType = FacilityType;

export type MaterialCategory = 'paper_cardboard' | 'plastics' | 'metals' | 'organic';

export type PurityGrade = 'Grade A' | 'Grade B' | 'Grade C';

// Strictly three distinct Waste Passport macro lifecycle states (NEVER conflate DELIVERED with RECYCLED)
export type LifecycleStatus = 'LISTED' | 'DELIVERED' | 'RECYCLED';

export type PickupStatus =
  | 'scheduled'
  | 'accepted'
  | 'en_route'
  | 'arrived'
  | 'picked_up'
  | 'delivered'
  | 'cancelled';

export type VerificationMethod = 'ble_scale' | 'manual_calibrated';

export const GOVERNORATES = [
  'Greater Cairo',
  'Giza',
  '6th of October',
  '10th of Ramadan',
  'Sadat City',
  'Borg El Arab',
] as const;

export const FACILITY_TYPE_LABELS: Record<FacilityType, { en: string; ar: string }> = {
  factory: { en: 'Manufacturing Factory', ar: 'مصنع إنتاجي' },
  company: { en: 'Corporate Company', ar: 'شركة / مقر إداري' },
  educational_institution: { en: 'Educational Institution', ar: 'مؤسسة تعليمية' },
  service_institution: { en: 'Service Institution', ar: 'مؤسسة خدمية' },
  hotel: { en: 'Hotel & Hospitality', ar: 'فندق ومنشأة ضيافة' },
  commercial: { en: 'Commercial Facility', ar: 'منشأة تجارية' },
};

export const HUB_TYPE_LABELS = FACILITY_TYPE_LABELS;

export const LIFECYCLE_STATUS_LABELS: Record<LifecycleStatus, { en: string; ar: string }> = {
  LISTED: { en: 'Listed', ar: 'مُدرج في السوق' },
  DELIVERED: { en: 'Delivered (Awaiting Recycling)', ar: 'تم التسليم (بانتظار التدوير)' },
  RECYCLED: { en: 'Verified Recycled', ar: 'تم التدوير المعتمد' },
};

export const ROLE_LABELS: Record<UserRole, { en: string; ar: string }> = {
  generator_ops: { en: 'Waste Generator Operations', ar: 'عمليات مولد المخلفات' },
  factory_procurement: { en: 'Recycling Factory Procurement', ar: 'مشتريات مصنع التدوير' },
  driver_3pl: { en: 'Certified 3PL Logistics Partner', ar: 'شريك النقل البيئي المعتمد (3PL)' },
  platform_admin: { en: 'OURO Platform Admin', ar: 'إدارة منصة أورو' },
};

export const DISPUTE_CATEGORIES = [
  { value: 'weight_discrepancy', id: 'weight_discrepancy', en: 'Weight Discrepancy', ar: 'اختلاف الوزن' },
  { value: 'purity_contamination', id: 'purity_contamination', en: 'Purity / Contamination', ar: 'نقاء / شوائب بالمادة' },
  { value: 'delayed_pickup', id: 'delayed_pickup', en: 'Delayed 3PL Pickup', ar: 'تأخر شركة النقل' },
  { value: 'documentation', id: 'documentation', en: 'Missing Documentation / Evidence', ar: 'نقص المستندات / الإثباتات' },
  { value: 'other', id: 'other', en: 'Other Operational Issue', ar: 'مشكلة تشغيلية أخرى' },
] as const;

export const VEHICLE_TYPES = [
  { value: 'flatbed_truck', en: 'Flatbed Truck (10t)', ar: 'شاحنة مسطحة (10 طن)' },
  { value: 'box_truck', en: 'Box Truck (15t)', ar: 'شاحنة صندوقية مغلقة (15 طن)' },
  { value: 'curtain_sider', en: 'Curtain-Sider Trailer (20t)', ar: 'مقطورة بستارة جانبية (20 طن)' },
  { value: 'compactor_rolloff', en: 'Roll-Off Compactor (12t)', ar: 'شاحنة ضاغطة (12 طن)' },
] as const;

// Baseline EPA WARM v16 / IPCC 2006 Avoided Emission Factors (metric tons CO2e per metric ton recycled)
// Live values are stored & managed in PostgreSQL `emission_factors` table.
export const MATERIAL_METADATA: Record<
  MaterialCategory,
  {
    en: string;
    ar: string;
    defaultRateEgp: number;
    co2eFactorPerTon: number;
    methodologyRef: string;
    defaultPhoto: string;
    subtypes: string[];
  }
> = {
  paper_cardboard: {
    en: 'Paper & Cardboard',
    ar: 'الورق والكرتون',
    defaultRateEgp: 9800,
    co2eFactorPerTon: 3.14,
    methodologyRef: 'EPA WARM v16 (Corrugated Containers / Mixed Paper Recycling)',
    defaultPhoto: '/src/assets/images/ouro_material_paper_1795358825477.jpg',
    subtypes: ['OCC Corrugated Bales', 'Kraft Paper', 'Sorted Office Paper'],
  },
  plastics: {
    en: 'Plastics (PET / HDPE / PP)',
    ar: 'البلاستيك (PET / HDPE / PP)',
    defaultRateEgp: 18500,
    co2eFactorPerTon: 1.52,
    methodologyRef: 'EPA WARM v16 & IPCC 2006 (PET / HDPE Post-Consumer Recycling)',
    defaultPhoto: '/src/assets/images/ouro_material_plastic_1795358823572.jpg',
    subtypes: ['Clear PET Bottle Bales', 'Natural HDPE Containers', 'Sorted PP Rigid Scrap'],
  },
  metals: {
    en: 'Metals (Aluminum / Steel)',
    ar: 'المعادن (ألومنيوم / صلب)',
    defaultRateEgp: 42000,
    co2eFactorPerTon: 4.85,
    methodologyRef: 'EPA WARM v16 / IPCC (Blended Aluminum UBC & Ferrous Steel Scrap)',
    defaultPhoto: '/src/assets/images/ouro_material_metals_1795358822912.jpg',
    subtypes: ['Compacted Aluminum UBC', 'Sorted Ferrous Steel Cubes', 'Clean Mixed Tinplate'],
  },
  organic: {
    en: 'Agricultural & Organic Recyclables',
    ar: 'المخلفات الزراعية والعضوية القابلة للتدوير',
    defaultRateEgp: 3600,
    co2eFactorPerTon: 0.86,
    methodologyRef: 'IPCC 2006 Vol. 5 (Aerobic Composting & Biomass Valorization)',
    defaultPhoto: '/src/assets/images/ouro_material_organic_1795358823637.jpg',
    subtypes: ['Shredded Palm Fronds Biomass', 'Dry Agricultural Fiber', 'Clean Organic Compost Feedstock'],
  },
};

export const HUB_FACILITY_IMAGE = '/src/assets/images/ouro_hub_facility_1795358822916.jpg';

export const PASSPORT_STAGES = [
  { stage: 1, en: 'Source Identification', ar: 'تحديد المصدر' },
  { stage: 2, en: 'Data Capture', ar: 'توثيق الوزن والبيانات' },
  { stage: 3, en: 'Digital Listing', ar: 'الإدراج الرقمي' },
  { stage: 4, en: 'Intelligent Matching', ar: 'المطابقة الذكية' },
  { stage: 5, en: 'Reservation & Allocation', ar: 'الحجز وتخصيص الكمية' },
  { stage: 6, en: '3PL Logistics & Delivery', ar: 'النقل والتسليم (3PL)' },
  { stage: 7, en: 'Verified Recycling & ESG', ar: 'التدوير المعتمد والأثر البيئي' },
] as const;

export const PICKUP_STATUS_FLOW: PickupStatus[] = [
  'scheduled',
  'accepted',
  'en_route',
  'arrived',
  'picked_up',
  'delivered',
];

export const PICKUP_STATUS_LABELS: Record<PickupStatus, { en: string; ar: string }> = {
  scheduled: { en: 'Scheduled', ar: 'مجدول' },
  accepted: { en: 'Accepted by 3PL', ar: 'مقبول من شركة النقل' },
  en_route: { en: 'En Route', ar: 'في الطريق' },
  arrived: { en: 'Arrived at Facility', ar: 'وصل للمنشأة' },
  picked_up: { en: 'Picked Up', ar: 'تم الاستلام' },
  delivered: { en: 'Delivered to Recycler', ar: 'تم التسليم للمصنع' },
  cancelled: { en: 'Cancelled', ar: 'ملغي' },
};

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

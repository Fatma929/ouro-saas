import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// 1. B2B & Institutional Waste Generators (Factories, Companies, Educational/Service Institutions, Hotels, Commercial)
export const wasteSourceHubs = pgTable('waste_source_hubs', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  hubType: text('hub_type').notNull(), // factory | company | educational_institution | service_institution | hotel | commercial
  commercialRegNo: text('commercial_reg_no'),
  contactPhone: text('contact_phone'),
  governorate: text('governorate').notNull(), // Greater Cairo | Giza | 6th of October | 10th of Ramadan | Sadat City | Borg El Arab
  address: text('address').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  maxCapacityTons: doublePrecision('max_capacity_tons').notNull().default(40),
  availableTons: doublePrecision('available_tons').notNull().default(0),
  reservedTons: doublePrecision('reserved_tons').notNull().default(0),
  purityScore: doublePrecision('purity_score').notNull().default(94.0),
  lastPickupAt: timestamp('last_pickup_at'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 2. Recycling Factories (B2B Buyers with KYC Governance)
export const recyclingFactories = pgTable('recycling_factories', {
  id: serial('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  industrialZone: text('industrial_zone').notNull(),
  governorate: text('governorate').notNull(),
  taxId: text('tax_id').notNull(),
  commercialRegNo: text('commercial_reg_no').notNull(),
  contactPerson: text('contact_person').notNull(),
  phone: text('phone').notNull(),
  preferredCategories: text('preferred_categories').notNull().default('["paper_cardboard","plastics"]'),
  kycStatus: text('kyc_status').notNull().default('pending'), // pending | approved | rejected
  kycDocumentFileId: integer('kyc_document_file_id'),
  kycDocumentName: text('kyc_document_name'),
  kycReviewNote: text('kyc_review_note'),
  kycReviewedByUid: text('kyc_reviewed_by_uid'),
  kycReviewedAt: timestamp('kyc_reviewed_at'),
  lat: doublePrecision('lat').notNull().default(29.972),
  lng: doublePrecision('lng').notNull().default(30.942),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 3. Certified Third-Party Logistics (3PL) Providers (Asset-Light Model)
export const logisticsProviders = pgTable('logistics_providers', {
  id: serial('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  envTransportLicenseId: text('env_transport_license_id').notNull().unique(),
  licenseExpiry: text('license_expiry').notNull(),
  fleetCount: integer('fleet_count').notNull().default(8),
  onTimeRate: doublePrecision('on_time_rate').notNull().default(96.5),
  contactPhone: text('contact_phone').notNull(),
  isVerified: boolean('is_verified').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 4. Users (Linked to Firebase Auth UID + Salted Scrypt Credentials for Role Auth)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  accountCode: text('account_code').unique(), // e.g. GEN-OPS-001, DRV-3PL-001
  role: text('role').notNull(), // generator_ops | factory_procurement | driver_3pl | platform_admin
  hubId: integer('hub_id').references(() => wasteSourceHubs.id),
  factoryId: integer('factory_id').references(() => recyclingFactories.id),
  logisticsProviderId: integer('logistics_provider_id').references(() => logisticsProviders.id),
  language: text('language').notNull().default('en'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 5. Cloud Object Storage (PostgreSQL-backed immutable media & KYC document store)
export const fileObjects = pgTable('file_objects', {
  id: serial('id').primaryKey(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  purpose: text('purpose').notNull(), // weighin_photo | kyc_document
  dataBase64: text('data_base64').notNull(),
  uploadedByUid: text('uploaded_by_uid'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 6. Ouro Digital Waste Passports (7-Stage Chain of Custody)
export const wastePassports = pgTable('waste_passports', {
  id: serial('id').primaryKey(),
  passportCode: text('passport_code').notNull().unique(), // OURO-PAS-2026-XXXXXX
  hubId: integer('hub_id')
    .references(() => wasteSourceHubs.id)
    .notNull(),
  materialCategory: text('material_category').notNull(), // paper_cardboard | plastics | metals | organic
  materialSubtype: text('material_subtype').notNull(),
  purityGrade: text('purity_grade').notNull(), // Grade A | Grade B | Grade C
  initialWeightKg: doublePrecision('initial_weight_kg').notNull(),
  availableTons: doublePrecision('available_tons').notNull(),
  reservedTons: doublePrecision('reserved_tons').notNull().default(0),
  deliveredTons: doublePrecision('delivered_tons').notNull().default(0),
  pricePerTonEgp: doublePrecision('price_per_ton_egp').notNull(),
  verificationMethod: text('verification_method').notNull(), // ble_scale | manual_calibrated
  photoFileId: integer('photo_file_id').references(() => fileObjects.id),
  photoUrl: text('photo_url'),
  pickupWindow: text('pickup_window').notNull(),
  currentStage: integer('current_stage').notNull().default(3), // 1..7
  status: text('status').notNull().default('listed'), // listed | reserved | in_transit | delivered | verified_esg
  co2eFactorPerTon: doublePrecision('co2e_factor_per_ton').notNull(),
  verifiedCo2eTons: doublePrecision('verified_co2e_tons').notNull().default(0),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 7. Reservations & Certified 3PL Pickup Jobs (Stages 5–7)
export const reservations = pgTable('reservations', {
  id: serial('id').primaryKey(),
  reservationCode: text('reservation_code').notNull().unique(),
  passportId: integer('passport_id')
    .references(() => wastePassports.id)
    .notNull(),
  hubId: integer('hub_id')
    .references(() => wasteSourceHubs.id)
    .notNull(),
  factoryId: integer('factory_id')
    .references(() => recyclingFactories.id)
    .notNull(),
  logisticsProviderId: integer('logistics_provider_id')
    .references(() => logisticsProviders.id)
    .notNull(),
  driverUserId: integer('driver_user_id').references(() => users.id),
  quantityTons: doublePrecision('quantity_tons').notNull(),
  pricePerTonEgp: doublePrecision('price_per_ton_egp').notNull(),
  totalEgp: doublePrecision('total_egp').notNull(),
  pickupWindow: text('pickup_window').notNull(),
  pickupStatus: text('pickup_status').notNull().default('scheduled'), // scheduled | en_route | arrived | picked_up | delivered
  handoffWeightKg: doublePrecision('handoff_weight_kg'),
  handoffVerificationMethod: text('handoff_verification_method'), // ble_scale | manifest_confirmed
  handoffQrVerified: boolean('handoff_qr_verified').notNull().default(false),
  handoffGpsLat: doublePrecision('handoff_gps_lat'),
  handoffGpsLng: doublePrecision('handoff_gps_lng'),
  handoffVerifiedAt: timestamp('handoff_verified_at'),
  deliveredAt: timestamp('delivered_at'),
  co2eAvoidedTons: doublePrecision('co2e_avoided_tons').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 8. Append-Only Immutable Passport Events Audit Trail
export const passportEvents = pgTable('passport_events', {
  id: serial('id').primaryKey(),
  passportId: integer('passport_id')
    .references(() => wastePassports.id)
    .notNull(),
  stage: integer('stage').notNull(), // 1..7
  eventType: text('event_type').notNull(),
  actorName: text('actor_name').notNull(),
  actorRole: text('actor_role').notNull(),
  summaryEn: text('summary_en').notNull(),
  summaryAr: text('summary_ar').notNull(),
  metadataJson: text('metadata_json'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 9. Admin Governance Audit Logs (KYC Reviews, Hub Registrations, 3PL Dispatches)
export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: serial('id').primaryKey(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  actorEmail: text('actor_email').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const wasteSourceHubsRelations = relations(wasteSourceHubs, ({ many }) => ({
  passports: many(wastePassports),
  reservations: many(reservations),
}));

export const wastePassportsRelations = relations(wastePassports, ({ one, many }) => ({
  hub: one(wasteSourceHubs, {
    fields: [wastePassports.hubId],
    references: [wasteSourceHubs.id],
  }),
  events: many(passportEvents),
  reservations: many(reservations),
}));

export const reservationsRelations = relations(reservations, ({ one }) => ({
  passport: one(wastePassports, {
    fields: [reservations.passportId],
    references: [wastePassports.id],
  }),
  hub: one(wasteSourceHubs, {
    fields: [reservations.hubId],
    references: [wasteSourceHubs.id],
  }),
  factory: one(recyclingFactories, {
    fields: [reservations.factoryId],
    references: [recyclingFactories.id],
  }),
  logisticsProvider: one(logisticsProviders, {
    fields: [reservations.logisticsProviderId],
    references: [logisticsProviders.id],
  }),
}));

export const passportEventsRelations = relations(passportEvents, ({ one }) => ({
  passport: one(wastePassports, {
    fields: [passportEvents.passportId],
    references: [wastePassports.id],
  }),
}));

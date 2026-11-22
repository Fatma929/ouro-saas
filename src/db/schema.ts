import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// 1. B2B & Institutional Waste Generators (Factories, Companies, Educational/Service Institutions, Hotels, Commercial)
export const wasteSourceHubs = pgTable(
  'waste_source_hubs',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    hubType: text('hub_type').notNull(), // factory | company | educational_institution | service_institution | hotel | commercial
    commercialRegNo: text('commercial_reg_no'),
    contactPhone: text('contact_phone'),
    verificationStatus: text('verification_status').notNull().default('verified'), // pending | verified | suspended
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
  },
  (t) => [index('idx_hubs_governorate').on(t.governorate), index('idx_hubs_type').on(t.hubType)]
);

// 2. Recycling Factories (B2B Buyers with KYC Governance & Processing Capabilities)
export const recyclingFactories = pgTable(
  'recycling_factories',
  {
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
    monthlyCapacityTons: doublePrecision('monthly_capacity_tons').notNull().default(250),
    acceptedGrades: text('accepted_grades').notNull().default('["Grade A","Grade B"]'),
    procurementNotes: text('procurement_notes'),
    kycStatus: text('kyc_status').notNull().default('pending'), // pending | approved | rejected
    kycDocumentFileId: integer('kyc_document_file_id'),
    kycDocumentName: text('kyc_document_name'),
    kycReviewNote: text('kyc_review_note'),
    kycReviewedByUid: text('kyc_reviewed_by_uid'),
    kycReviewedAt: timestamp('kyc_reviewed_at'),
    lat: doublePrecision('lat').notNull().default(29.972),
    lng: doublePrecision('lng').notNull().default(30.942),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_factories_kyc').on(t.kycStatus)]
);

// 3. Certified Third-Party Logistics (3PL) Providers (Strict Asset-Light Model)
export const logisticsProviders = pgTable('logistics_providers', {
  id: serial('id').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  envTransportLicenseId: text('env_transport_license_id').notNull().unique(),
  licenseExpiry: text('license_expiry').notNull(),
  fleetCount: integer('fleet_count').notNull().default(8),
  onTimeRate: doublePrecision('on_time_rate').notNull().default(96.5),
  contactPhone: text('contact_phone').notNull(),
  verificationStatus: text('verification_status').notNull().default('approved'), // pending | approved | suspended
  isVerified: boolean('is_verified').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 3b. Independent 3PL Registered Vehicles (External Carrier Fleet)
export const logisticsVehicles = pgTable(
  'logistics_vehicles',
  {
    id: serial('id').primaryKey(),
    logisticsProviderId: integer('logistics_provider_id')
      .references(() => logisticsProviders.id)
      .notNull(),
    plateNumber: text('plate_number').notNull().unique(),
    vehicleType: text('vehicle_type').notNull(), // Flatbed Truck | Box Truck | Roll-Off Compactor | Curtain-Sider
    capacityTons: doublePrecision('capacity_tons').notNull(),
    envPermitNo: text('env_permit_no').notNull(),
    permitExpiry: text('permit_expiry').notNull(),
    driverName: text('driver_name').notNull(),
    verificationStatus: text('verification_status').notNull().default('verified'), // pending | verified | rejected
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_vehicles_provider').on(t.logisticsProviderId)]
);

// 4. Users (Linked to Firebase Auth UID + Salted Scrypt Credentials for Role Auth)
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    accountCode: text('account_code').unique(), // e.g. GEN-OPS-001, DRV-3PL-001
    role: text('role').notNull(), // generator_ops | factory_procurement | driver_3pl | platform_admin
    isActive: boolean('is_active').notNull().default(true),
    hubId: integer('hub_id').references(() => wasteSourceHubs.id),
    factoryId: integer('factory_id').references(() => recyclingFactories.id),
    logisticsProviderId: integer('logistics_provider_id').references(() => logisticsProviders.id),
    language: text('language').notNull().default('en'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_users_role').on(t.role)]
);

// 5. Private Object Storage Metadata (Disk-backed private storage with SHA-256 digest + object ACLs)
export const fileObjects = pgTable('file_objects', {
  id: serial('id').primaryKey(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  purpose: text('purpose').notNull(), // weighin_photo | kyc_document | supporting_doc | pod_document | weighbridge_ticket | recycling_evidence
  storagePath: text('storage_path'), // relative path inside private storage root
  sha256: text('sha256'),
  dataBase64: text('data_base64').notNull().default(''), // legacy fallback only for small seeded rows
  uploadedByUid: text('uploaded_by_uid'),
  ownerOrgType: text('owner_org_type'), // hub | factory | logistics_provider | platform
  ownerOrgId: integer('owner_org_id'),
  linkedEntityType: text('linked_entity_type'), // passport | reservation | factory
  linkedEntityId: integer('linked_entity_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 6. Configurable Scientific Emission Factors (EPA WARM / IPCC / Defra)
export const emissionFactors = pgTable('emission_factors', {
  id: serial('id').primaryKey(),
  materialCategory: text('material_category').notNull().unique(), // paper_cardboard | plastics | metals | organic
  labelEn: text('label_en').notNull(),
  labelAr: text('label_ar').notNull(),
  co2eFactorPerTon: doublePrecision('co2e_factor_per_ton').notNull(),
  transportFactorKgPerTonKm: doublePrecision('transport_factor_kg_per_ton_km').notNull().default(0.105),
  methodologyName: text('methodology_name').notNull(),
  sourceRef: text('source_ref').notNull(),
  version: text('version').notNull(),
  boundaryNotes: text('boundary_notes').notNull(),
  baselineScenario: text('baseline_scenario').notNull(),
  dataQualityTier: text('data_quality_tier').notNull().default('Tier 2 — Regional Industrial Secondary Data'),
  updatedByEmail: text('updated_by_email'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 7. Ouro Digital Waste Passports (7-Stage Chain of Custody with Strict LISTED / DELIVERED / RECYCLED Reconciliation)
export const wastePassports = pgTable(
  'waste_passports',
  {
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
    collectedTons: doublePrecision('collected_tons').notNull().default(0),
    deliveredTons: doublePrecision('delivered_tons').notNull().default(0),
    recycledTons: doublePrecision('recycled_tons').notNull().default(0),
    residualTons: doublePrecision('residual_tons').notNull().default(0),
    rejectedTons: doublePrecision('rejected_tons').notNull().default(0),
    pricePerTonEgp: doublePrecision('price_per_ton_egp').notNull(),
    verificationMethod: text('verification_method').notNull(), // ble_scale | manual_calibrated
    photoFileId: integer('photo_file_id').references(() => fileObjects.id),
    photoUrl: text('photo_url'),
    supportingDocFileId: integer('supporting_doc_file_id').references(() => fileObjects.id),
    supportingDocName: text('supporting_doc_name'),
    notes: text('notes'),
    pickupWindow: text('pickup_window').notNull(),
    currentStage: integer('current_stage').notNull().default(3), // 1..7
    lifecycleStatus: text('lifecycle_status').notNull().default('LISTED'), // STRICTLY: LISTED | DELIVERED | RECYCLED
    status: text('status').notNull().default('listed'), // listed | reserved | in_transit | delivered | recycled | cancelled
    co2eFactorPerTon: doublePrecision('co2e_factor_per_ton').notNull(),
    emissionFactorVersion: text('emission_factor_version').notNull().default('EPA WARM v16 / IPCC 2006'),
    verifiedCo2eTons: doublePrecision('verified_co2e_tons').notNull().default(0), // ONLY from verified recycledTons!
    isSampleData: boolean('is_sample_data').notNull().default(false),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_passports_hub').on(t.hubId),
    index('idx_passports_lifecycle').on(t.lifecycleStatus),
    index('idx_passports_category').on(t.materialCategory),
  ]
);

// 8. Reservations, 3PL Shipments, Factory Physical Receipt & Verified Recycling Outcomes (Stages 5–7)
export const reservations = pgTable(
  'reservations',
  {
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
    vehicleId: integer('vehicle_id').references(() => logisticsVehicles.id),
    quantityTons: doublePrecision('quantity_tons').notNull(),
    pricePerTonEgp: doublePrecision('price_per_ton_egp').notNull(),
    totalEgp: doublePrecision('total_egp').notNull(),
    pickupWindow: text('pickup_window').notNull(),
    pickupStatus: text('pickup_status').notNull().default('scheduled'), // scheduled | accepted | en_route | arrived | picked_up | delivered | cancelled
    acceptedBy3plAt: timestamp('accepted_by_3pl_at'),
    handoffWeightKg: doublePrecision('handoff_weight_kg'),
    handoffVerificationMethod: text('handoff_verification_method'), // ble_scale | manifest_confirmed
    handoffQrVerified: boolean('handoff_qr_verified').notNull().default(false),
    handoffGpsLat: doublePrecision('handoff_gps_lat'),
    handoffGpsLng: doublePrecision('handoff_gps_lng'),
    handoffVerifiedAt: timestamp('handoff_verified_at'),
    deliveredAt: timestamp('delivered_at'),
    podFileId: integer('pod_file_id').references(() => fileObjects.id),
    podFileName: text('pod_file_name'),
    // Factory Physical Receipt (strictly separate from 3PL delivery & recycling)
    receiptStatus: text('receipt_status').notNull().default('pending'), // pending | received | disputed
    receivedAt: timestamp('received_at'),
    receivedWeightKg: doublePrecision('received_weight_kg'),
    weighbridgeFileId: integer('weighbridge_file_id').references(() => fileObjects.id),
    weighbridgeFileName: text('weighbridge_file_name'),
    // Verified Recycling Outcome (Stage 7 — ONLY source of verified RECYCLED ESG claims)
    recyclingStatus: text('recycling_status').notNull().default('not_started'), // not_started | verified_recycled
    recycledAt: timestamp('recycled_at'),
    recoveredTons: doublePrecision('recovered_tons').notNull().default(0),
    residualTons: doublePrecision('residual_tons').notNull().default(0),
    lossTons: doublePrecision('loss_tons').notNull().default(0),
    recyclingEvidenceFileId: integer('recycling_evidence_file_id').references(() => fileObjects.id),
    recyclingEvidenceName: text('recycling_evidence_name'),
    recyclingNotes: text('recycling_notes'),
    // Transparent ESG calculation fields
    transportDistanceKm: doublePrecision('transport_distance_km').notNull().default(0),
    transportEmissionsTons: doublePrecision('transport_emissions_tons').notNull().default(0),
    co2eAvoidedTons: doublePrecision('co2e_avoided_tons').notNull().default(0), // Strictly net verified CO2e after recycling verification!
    estimatedCo2eTons: doublePrecision('estimated_co2e_tons').notNull().default(0),
    esgConfidenceLevel: text('esg_confidence_level').notNull().default('estimated'), // estimated | calculated | verified
    expiresAt: timestamp('expires_at'),
    cancelledAt: timestamp('cancelled_at'),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_res_passport').on(t.passportId),
    index('idx_res_factory').on(t.factoryId),
    index('idx_res_provider').on(t.logisticsProviderId),
    index('idx_res_status').on(t.pickupStatus),
  ]
);

// 9. Append-Only Tamper-Evident Passport Events Audit Trail (SHA-256 Hash Chain)
export const passportEvents = pgTable(
  'passport_events',
  {
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
    evidenceFileId: integer('evidence_file_id').references(() => fileObjects.id),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    prevHash: text('prev_hash').notNull().default('GENESIS'),
    eventHash: text('event_hash').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_events_passport').on(t.passportId)]
);

// 10. In-App Notifications
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id),
    targetRole: text('target_role'),
    type: text('type').notNull(), // reservation | shipment | delivery | recycling | kyc | dispute | system
    titleEn: text('title_en').notNull(),
    titleAr: text('title_ar').notNull(),
    messageEn: text('message_en').notNull(),
    messageAr: text('message_ar').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_notif_user').on(t.userId), index('idx_notif_role').on(t.targetRole)]
);

// 11. Disputes & Incident Governance
export const disputes = pgTable(
  'disputes',
  {
    id: serial('id').primaryKey(),
    disputeCode: text('dispute_code').notNull().unique(),
    passportId: integer('passport_id').references(() => wastePassports.id),
    reservationId: integer('reservation_id').references(() => reservations.id),
    raisedByUserId: integer('raised_by_user_id')
      .references(() => users.id)
      .notNull(),
    raisedByOrgName: text('raised_by_org_name').notNull(),
    category: text('category').notNull(), // weight_discrepancy | purity_contamination | delayed_pickup | documentation | other
    severity: text('severity').notNull().default('medium'), // low | medium | high | critical
    status: text('status').notNull().default('open'), // open | investigating | resolved | dismissed
    description: text('description').notNull(),
    resolutionNote: text('resolution_note'),
    resolvedByEmail: text('resolved_by_email'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at'),
  },
  (t) => [index('idx_disputes_status').on(t.status)]
);

// 12. Idempotency Keys (Prevents Duplicate Reservation / Verification Submissions)
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: serial('id').primaryKey(),
    key: text('key').notNull().unique(),
    userId: integer('user_id').notNull(),
    endpoint: text('endpoint').notNull(),
    statusCode: integer('status_code').notNull(),
    responseJson: text('response_json').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_idempotency_key').on(t.key)]
);

// 13. Admin Governance Audit Logs
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

import { count } from 'drizzle-orm';
import { db } from './index.ts';
import {
  wasteSourceHubs,
  recyclingFactories,
  logisticsProviders,
  users,
  wastePassports,
  reservations,
  passportEvents,
  fileObjects,
  adminAuditLogs,
} from './schema.ts';
import { hashPassword } from '../lib/auth-utils.ts';
import { MATERIAL_METADATA } from '../shared/constants.ts';

let seedPromise: Promise<void> | null = null;

export async function ensureSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = runSeedIfEmpty().catch((err) => {
    seedPromise = null;
    throw err;
  });
  return seedPromise;
}

async function runSeedIfEmpty(): Promise<void> {
  const existing = await db.select({ total: count() }).from(wasteSourceHubs);
  if ((existing[0]?.total ?? 0) > 0) {
    return;
  }

  console.log('Seeding OURO Egypt & MENA production pilot dataset...');

  // 1. Seed B2B & Institutional Waste Generators (Factory, Company, Educational, Service, Hotel, Commercial)
  const insertedHubs = await db
    .insert(wasteSourceHubs)
    .values([
      {
        code: 'GEN-GIZ-CO01',
        nameEn: 'Smart Village Corporate Business Park',
        nameAr: 'مجمع القرية الذكية للشركات والمقرات الإدارية',
        hubType: 'company',
        commercialRegNo: 'CR-GIZ-319402',
        contactPhone: '+20 100 712 4401',
        governorate: 'Giza',
        address: 'Km 28 Cairo-Alexandria Desert Rd, Smart Village, Giza, Egypt',
        lat: 30.0715,
        lng: 31.0168,
        maxCapacityTons: 25,
        availableTons: 12.6,
        reservedTons: 8.8, // 21.4 / 25 = 85.6% -> triggers >=80% capacity alert
        purityScore: 96.4,
        lastPickupAt: new Date(Date.now() - 1000 * 60 * 60 * 38),
      },
      {
        code: 'GEN-CAI-ED02',
        nameEn: 'Cairo Modern University Campus',
        nameAr: 'حرم جامعة القاهرة الحديثة — المؤسسة التعليمية',
        hubType: 'educational_institution',
        commercialRegNo: 'CR-CAI-502881',
        contactPhone: '+20 102 640 1190',
        governorate: 'Greater Cairo',
        address: 'Fifth Settlement Campus Axis, New Cairo, Egypt',
        lat: 30.0205,
        lng: 31.4998,
        maxCapacityTons: 20,
        availableTons: 8.4,
        reservedTons: 4.5,
        purityScore: 94.8,
        lastPickupAt: new Date(Date.now() - 1000 * 60 * 60 * 18),
      },
      {
        code: 'GEN-OCT-FC03',
        nameEn: 'October Food & Beverage Packaging Plant',
        nameAr: 'مصنع السادس من أكتوبر لتعبئة الأغذية والمشروبات',
        hubType: 'factory',
        commercialRegNo: 'CR-OCT-618220',
        contactPhone: '+20 106 330 7812',
        governorate: '6th of October',
        address: 'Industrial Zone 4, Central Axis, 6th of October City, Egypt',
        lat: 29.9697,
        lng: 30.9462,
        maxCapacityTons: 30,
        availableTons: 11.2,
        reservedTons: 5.0,
        purityScore: 95.1,
        lastPickupAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
      },
      {
        code: 'GEN-RAM-SV04',
        nameEn: '10th of Ramadan Regional Medical & Service Complex',
        nameAr: 'المجمع الطبي والخدمي بالعاشر من رمضان',
        hubType: 'service_institution',
        commercialRegNo: 'CR-SHQ-440915',
        contactPhone: '+20 111 904 5520',
        governorate: '10th of Ramadan',
        address: 'Central Service District, 10th of Ramadan City, Egypt',
        lat: 30.3065,
        lng: 31.7414,
        maxCapacityTons: 28,
        availableTons: 16.5,
        reservedTons: 7.2, // 23.7 / 28 = 84.6% -> triggers >=80% capacity alert
        purityScore: 93.2,
        lastPickupAt: new Date(Date.now() - 1000 * 60 * 60 * 52),
      },
      {
        code: 'GEN-CAI-HT05',
        nameEn: 'Nile Corniche Grand Hospitality Group',
        nameAr: 'مجموعة فنادق كورنيش النيل للضيافة',
        hubType: 'hotel',
        commercialRegNo: 'CR-CAI-774108',
        contactPhone: '+20 100 889 2300',
        governorate: 'Greater Cairo',
        address: 'Corniche El Nil, Garden City, Cairo, Egypt',
        lat: 30.0365,
        lng: 31.2315,
        maxCapacityTons: 18,
        availableTons: 6.2,
        reservedTons: 2.0,
        purityScore: 97.6,
        lastPickupAt: new Date(Date.now() - 1000 * 60 * 60 * 14),
      },
      {
        code: 'GEN-SAD-FC06',
        nameEn: 'Sadat Agro-Packaging Industrial Plant',
        nameAr: 'مصنع السادات للتعبئة والصناعات الزراعية',
        hubType: 'factory',
        commercialRegNo: 'CR-SAD-229510',
        contactPhone: '+20 120 451 6670',
        governorate: 'Sadat City',
        address: 'Industrial Zone 3, Sadat City, Menoufia, Egypt',
        lat: 30.3694,
        lng: 30.5174,
        maxCapacityTons: 45,
        availableTons: 18.0,
        reservedTons: 6.0,
        purityScore: 92.5,
        lastPickupAt: new Date(Date.now() - 1000 * 60 * 60 * 29),
      },
      {
        code: 'GEN-CAI-CM07',
        nameEn: 'New Cairo Grand Retail & Logistics Mall',
        nameAr: 'مول ومجمع القاهرة الجديدة التجاري واللوجستي',
        hubType: 'commercial',
        commercialRegNo: 'CR-CAI-893014',
        contactPhone: '+20 109 112 9400',
        governorate: 'Greater Cairo',
        address: 'North 90th Street, Fifth Settlement, New Cairo, Egypt',
        lat: 30.0259,
        lng: 31.4913,
        maxCapacityTons: 24,
        availableTons: 9.5,
        reservedTons: 3.0,
        purityScore: 95.8,
        lastPickupAt: new Date(Date.now() - 1000 * 60 * 60 * 12),
      },
    ])
    .returning();

  // 2. Seed Certified 3PL Logistics Providers
  const insertedProviders = await db
    .insert(logisticsProviders)
    .values([
      {
        nameEn: 'NileGreen Certified 3PL Freight',
        nameAr: 'النيل الأخضر للنقل البيئي المعتمد',
        envTransportLicenseId: 'EEAA-3PL-EG-2026-0148',
        licenseExpiry: '2028-06-30',
        fleetCount: 18,
        onTimeRate: 97.4,
        contactPhone: '+20 100 412 8890',
        isVerified: true,
      },
      {
        nameEn: 'Delta Circular Hauling & Logistics',
        nameAr: 'دلتا للخدمات اللوجستية الدائرية',
        envTransportLicenseId: 'EEAA-3PL-EG-2026-0219',
        licenseExpiry: '2027-12-31',
        fleetCount: 14,
        onTimeRate: 95.8,
        contactPhone: '+20 111 739 2045',
        isVerified: true,
      },
      {
        nameEn: 'Pyramid Eco-Corridor Transport',
        nameAr: 'بيراميدز للنقل البيئي والممرات الصناعية',
        envTransportLicenseId: 'EEAA-3PL-EG-2026-0304',
        licenseExpiry: '2028-03-15',
        fleetCount: 11,
        onTimeRate: 94.2,
        contactPhone: '+20 122 885 3310',
        isVerified: true,
      },
    ])
    .returning();

  // 3. Seed Sample KYC Document Object for Pending Factory Review
  const sampleKycText = Buffer.from(
    `ARAB REPUBLIC OF EGYPT - COMMERCIAL REGISTRY & TAX CARD EXTRACT\n` +
      `Entity: Delta Polymer & Fiber Recycling S.A.E.\n` +
      `Commercial Registration No: CR-SADAT-884210\n` +
      `Tax Card ID: 492-810-337\n` +
      `Industrial Zone: Sadat City Industrial Zone 4\n` +
      `Environmental Operating Permit: EEAA-IND-2026-9914\n` +
      `Submitted for OURO B2B Procurement Verification.\n`,
    'utf8'
  );

  const insertedKycDoc = await db
    .insert(fileObjects)
    .values({
      originalName: 'Delta_Polymer_Commercial_Reg_and_Tax_KYC.txt',
      mimeType: 'text/plain',
      sizeBytes: sampleKycText.length,
      purpose: 'kyc_document',
      dataBase64: sampleKycText.toString('base64'),
      uploadedByUid: 'seed-factory-pending',
    })
    .returning();

  // 4. Seed Recycling Factories (2 Approved + 1 Pending KYC)
  const insertedFactories = await db
    .insert(recyclingFactories)
    .values([
      {
        nameEn: 'Nile Kraft & Packaging Mills S.A.E.',
        nameAr: 'مطاحن النيل للورق والتغليف ش.م.م',
        industrialZone: '6th of October Industrial Zone 2',
        governorate: '6th of October',
        taxId: '304-552-819',
        commercialRegNo: 'CR-GIZ-441092',
        contactPerson: 'Eng. Tarek El-Masry',
        phone: '+20 100 554 9012',
        preferredCategories: JSON.stringify(['paper_cardboard', 'plastics']),
        kycStatus: 'approved',
        kycDocumentName: 'Nile_Kraft_KYC_Verified_2026.pdf',
        kycReviewNote: 'Verified Tax ID, CR extract, and EEAA recycling permit.',
        kycReviewedByUid: 'seed-admin',
        kycReviewedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 18),
        lat: 29.9368,
        lng: 30.8925,
      },
      {
        nameEn: 'Ramadan Eco-Polymers & Metals Recovery',
        nameAr: 'العاشر لإعادة تدوير البوليمرات والمعادن',
        industrialZone: '10th of Ramadan Heavy Industrial Zone B2',
        governorate: '10th of Ramadan',
        taxId: '518-290-644',
        commercialRegNo: 'CR-SHQ-772315',
        contactPerson: 'Mona Abdel-Rahman',
        phone: '+20 109 321 7740',
        preferredCategories: JSON.stringify(['plastics', 'metals']),
        kycStatus: 'approved',
        kycDocumentName: 'Ramadan_EcoPolymers_License_2026.pdf',
        kycReviewNote: 'Approved for Class-A PET/HDPE and aluminum intake.',
        kycReviewedByUid: 'seed-admin',
        kycReviewedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12),
        lat: 30.2895,
        lng: 31.7628,
      },
      {
        nameEn: 'Delta Polymer & Fiber Recycling S.A.E.',
        nameAr: 'دلتا لتدوير البوليمرات والألياف ش.م.م',
        industrialZone: 'Sadat City Industrial Zone 4',
        governorate: 'Sadat City',
        taxId: '492-810-337',
        commercialRegNo: 'CR-SADAT-884210',
        contactPerson: 'Karim Mansour',
        phone: '+20 128 904 1152',
        preferredCategories: JSON.stringify(['plastics', 'organic', 'paper_cardboard']),
        kycStatus: 'pending',
        kycDocumentFileId: insertedKycDoc[0].id,
        kycDocumentName: 'Delta_Polymer_Commercial_Reg_and_Tax_KYC.txt',
        lat: 30.3552,
        lng: 30.5031,
      },
    ])
    .returning();

  // 5. Seed Production Accounts for All 4 Roles
  const defaultPwdHash = hashPassword('OuroDemo#2026');
  const insertedUsers = await db
    .insert(users)
    .values([
      {
        uid: 'ouro-admin-owner',
        email: 'fatmaelzahraalegal@gmail.com',
        passwordHash: defaultPwdHash,
        fullName: 'Fatma El-Zahraa (Platform Admin)',
        phone: '+20 100 000 0001',
        accountCode: 'ADM-OURO-001',
        role: 'platform_admin',
        language: 'en',
      },
      {
        uid: 'ouro-admin-ops',
        email: 'admin@ouro.eco',
        passwordHash: defaultPwdHash,
        fullName: 'Salma Hassan (Operations Admin)',
        phone: '+20 100 201 4400',
        accountCode: 'ADM-OURO-002',
        role: 'platform_admin',
        language: 'en',
      },
      {
        uid: 'ouro-generator-co01',
        email: 'ops@smartvillage.eg',
        passwordHash: defaultPwdHash,
        fullName: 'Ahmed Mostafa (Facility Sustainability Lead)',
        phone: '+20 101 882 3401',
        accountCode: 'GEN-OPS-001',
        role: 'generator_ops',
        hubId: insertedHubs[0].id,
        language: 'en',
      },
      {
        uid: 'ouro-factory-approved',
        email: 'procurement@nilekraft.eg',
        passwordHash: defaultPwdHash,
        fullName: 'Eng. Tarek El-Masry',
        phone: '+20 100 554 9012',
        accountCode: 'FAC-OCT-001',
        role: 'factory_procurement',
        factoryId: insertedFactories[0].id,
        language: 'en',
      },
      {
        uid: 'ouro-factory-pending',
        email: 'kyc-pending@deltapolymer.eg',
        passwordHash: defaultPwdHash,
        fullName: 'Karim Mansour',
        phone: '+20 128 904 1152',
        accountCode: 'FAC-SAD-003',
        role: 'factory_procurement',
        factoryId: insertedFactories[2].id,
        language: 'en',
      },
      {
        uid: 'ouro-driver-3pl-01',
        email: 'driver@nilegreen3pl.eg',
        passwordHash: defaultPwdHash,
        fullName: 'Mahmoud Saeed',
        phone: '+20 100 412 8895',
        accountCode: 'DRV-3PL-001',
        role: 'driver_3pl',
        logisticsProviderId: insertedProviders[0].id,
        language: 'en',
      },
    ])
    .returning();

  const workerUser = insertedUsers.find((u) => u.role === 'generator_ops')!;
  const driverUser = insertedUsers.find((u) => u.role === 'driver_3pl')!;

  // 6. Seed 8 Digital Waste Passports across Materials, Hubs, and Stages (3, 5, 6, 7)
  const now = Date.now();
  const insertedPassports = await db
    .insert(wastePassports)
    .values([
      {
        passportCode: 'OURO-PAS-2026-841A2C',
        hubId: insertedHubs[0].id,
        materialCategory: 'paper_cardboard',
        materialSubtype: 'OCC Corrugated Bales',
        purityGrade: 'Grade A',
        initialWeightKg: 14600,
        availableTons: 8.6,
        reservedTons: 6.0,
        deliveredTons: 0,
        pricePerTonEgp: 10200,
        verificationMethod: 'ble_scale',
        photoUrl: MATERIAL_METADATA.paper_cardboard.defaultPhoto,
        pickupWindow: 'Tomorrow 08:00 - 12:00 EET',
        currentStage: 5,
        status: 'reserved',
        co2eFactorPerTon: MATERIAL_METADATA.paper_cardboard.co2eFactorPerTon,
        verifiedCo2eTons: 0,
        createdByUserId: workerUser.id,
        createdAt: new Date(now - 1000 * 60 * 60 * 26),
      },
      {
        passportCode: 'OURO-PAS-2026-912B4F',
        hubId: insertedHubs[1].id,
        materialCategory: 'plastics',
        materialSubtype: 'Clear PET Bottle Bales',
        purityGrade: 'Grade A',
        initialWeightKg: 10900,
        availableTons: 6.4,
        reservedTons: 4.5,
        deliveredTons: 0,
        pricePerTonEgp: 19400,
        verificationMethod: 'ble_scale',
        photoUrl: MATERIAL_METADATA.plastics.defaultPhoto,
        pickupWindow: 'Today 14:00 - 17:00 EET',
        currentStage: 6,
        status: 'in_transit',
        co2eFactorPerTon: MATERIAL_METADATA.plastics.co2eFactorPerTon,
        verifiedCo2eTons: 0,
        createdByUserId: workerUser.id,
        createdAt: new Date(now - 1000 * 60 * 60 * 20),
      },
      {
        passportCode: 'OURO-PAS-2026-733E19',
        hubId: insertedHubs[2].id,
        materialCategory: 'paper_cardboard',
        materialSubtype: 'Kraft Paper & Clean Cartons',
        purityGrade: 'Grade A',
        initialWeightKg: 11200,
        availableTons: 11.2,
        reservedTons: 0,
        deliveredTons: 0,
        pricePerTonEgp: 9850,
        verificationMethod: 'ble_scale',
        photoUrl: MATERIAL_METADATA.paper_cardboard.defaultPhoto,
        pickupWindow: 'Daily 09:00 - 15:00 EET',
        currentStage: 3,
        status: 'listed',
        co2eFactorPerTon: MATERIAL_METADATA.paper_cardboard.co2eFactorPerTon,
        verifiedCo2eTons: 0,
        createdByUserId: workerUser.id,
        createdAt: new Date(now - 1000 * 60 * 60 * 9),
      },
      {
        passportCode: 'OURO-PAS-2026-504D8A',
        hubId: insertedHubs[3].id,
        materialCategory: 'metals',
        materialSubtype: 'Compacted Aluminum UBC',
        purityGrade: 'Grade A',
        initialWeightKg: 9500,
        availableTons: 6.5,
        reservedTons: 3.0,
        deliveredTons: 0,
        pricePerTonEgp: 44500,
        verificationMethod: 'ble_scale',
        photoUrl: MATERIAL_METADATA.metals.defaultPhoto,
        pickupWindow: 'Tomorrow 07:00 - 11:00 EET',
        currentStage: 5,
        status: 'reserved',
        co2eFactorPerTon: MATERIAL_METADATA.metals.co2eFactorPerTon,
        verifiedCo2eTons: 0,
        createdByUserId: workerUser.id,
        createdAt: new Date(now - 1000 * 60 * 60 * 30),
      },
      {
        passportCode: 'OURO-PAS-2026-621F03',
        hubId: insertedHubs[4].id,
        materialCategory: 'plastics',
        materialSubtype: 'Natural HDPE Containers',
        purityGrade: 'Grade A',
        initialWeightKg: 6200,
        availableTons: 6.2,
        reservedTons: 0,
        deliveredTons: 0,
        pricePerTonEgp: 21000,
        verificationMethod: 'ble_scale',
        photoUrl: MATERIAL_METADATA.plastics.defaultPhoto,
        pickupWindow: 'Mon-Thu 10:00 - 16:00 EET',
        currentStage: 3,
        status: 'listed',
        co2eFactorPerTon: MATERIAL_METADATA.plastics.co2eFactorPerTon,
        verifiedCo2eTons: 0,
        createdByUserId: workerUser.id,
        createdAt: new Date(now - 1000 * 60 * 60 * 6),
      },
      {
        passportCode: 'OURO-PAS-2026-419C77',
        hubId: insertedHubs[5].id,
        materialCategory: 'organic',
        materialSubtype: 'Shredded Palm Fronds Biomass',
        purityGrade: 'Grade B',
        initialWeightKg: 18000,
        availableTons: 18.0,
        reservedTons: 0,
        deliveredTons: 0,
        pricePerTonEgp: 3650,
        verificationMethod: 'manual_calibrated',
        photoUrl: MATERIAL_METADATA.organic.defaultPhoto,
        pickupWindow: 'Sat-Wed 08:00 - 14:00 EET',
        currentStage: 3,
        status: 'listed',
        co2eFactorPerTon: MATERIAL_METADATA.organic.co2eFactorPerTon,
        verifiedCo2eTons: 0,
        createdByUserId: workerUser.id,
        createdAt: new Date(now - 1000 * 60 * 60 * 15),
      },
      {
        passportCode: 'OURO-PAS-2026-308A11',
        hubId: insertedHubs[6].id,
        materialCategory: 'paper_cardboard',
        materialSubtype: 'Sorted Office Paper',
        purityGrade: 'Grade A',
        initialWeightKg: 12000,
        availableTons: 0,
        reservedTons: 0,
        deliveredTons: 12.0,
        pricePerTonEgp: 10800,
        verificationMethod: 'ble_scale',
        photoUrl: MATERIAL_METADATA.paper_cardboard.defaultPhoto,
        pickupWindow: 'Completed',
        currentStage: 7,
        status: 'verified_esg',
        co2eFactorPerTon: MATERIAL_METADATA.paper_cardboard.co2eFactorPerTon,
        verifiedCo2eTons: Number((12.0 * MATERIAL_METADATA.paper_cardboard.co2eFactorPerTon).toFixed(2)),
        createdByUserId: workerUser.id,
        createdAt: new Date(now - 1000 * 60 * 60 * 24 * 6),
      },
      {
        passportCode: 'OURO-PAS-2026-205B94',
        hubId: insertedHubs[0].id,
        materialCategory: 'metals',
        materialSubtype: 'Sorted Ferrous Steel Cubes',
        purityGrade: 'Grade B',
        initialWeightKg: 8500,
        availableTons: 0,
        reservedTons: 0,
        deliveredTons: 8.5,
        pricePerTonEgp: 39200,
        verificationMethod: 'ble_scale',
        photoUrl: MATERIAL_METADATA.metals.defaultPhoto,
        pickupWindow: 'Completed',
        currentStage: 7,
        status: 'verified_esg',
        co2eFactorPerTon: MATERIAL_METADATA.metals.co2eFactorPerTon,
        verifiedCo2eTons: Number((8.5 * MATERIAL_METADATA.metals.co2eFactorPerTon).toFixed(2)),
        createdByUserId: workerUser.id,
        createdAt: new Date(now - 1000 * 60 * 60 * 24 * 11),
      },
    ])
    .returning();

  // 7. Seed Active & Completed 3PL Reservations
  await db.insert(reservations).values([
    {
      reservationCode: 'OURO-RES-2026-101A',
      passportId: insertedPassports[0].id,
      hubId: insertedHubs[0].id,
      factoryId: insertedFactories[0].id,
      logisticsProviderId: insertedProviders[0].id,
      driverUserId: driverUser.id,
      quantityTons: 6.0,
      pricePerTonEgp: 10200,
      totalEgp: 61200,
      pickupWindow: 'Tomorrow 08:00 - 12:00 EET',
      pickupStatus: 'scheduled',
      co2eAvoidedTons: Number((6.0 * MATERIAL_METADATA.paper_cardboard.co2eFactorPerTon).toFixed(2)),
      createdAt: new Date(now - 1000 * 60 * 60 * 10),
    },
    {
      reservationCode: 'OURO-RES-2026-102B',
      passportId: insertedPassports[1].id,
      hubId: insertedHubs[1].id,
      factoryId: insertedFactories[0].id,
      logisticsProviderId: insertedProviders[0].id,
      driverUserId: driverUser.id,
      quantityTons: 4.5,
      pricePerTonEgp: 19400,
      totalEgp: 87300,
      pickupWindow: 'Today 14:00 - 17:00 EET',
      pickupStatus: 'en_route',
      co2eAvoidedTons: Number((4.5 * MATERIAL_METADATA.plastics.co2eFactorPerTon).toFixed(2)),
      createdAt: new Date(now - 1000 * 60 * 60 * 5),
    },
    {
      reservationCode: 'OURO-RES-2026-103C',
      passportId: insertedPassports[3].id,
      hubId: insertedHubs[3].id,
      factoryId: insertedFactories[1].id,
      logisticsProviderId: insertedProviders[0].id,
      driverUserId: driverUser.id,
      quantityTons: 3.0,
      pricePerTonEgp: 44500,
      totalEgp: 133500,
      pickupWindow: 'Tomorrow 07:00 - 11:00 EET',
      pickupStatus: 'arrived',
      co2eAvoidedTons: Number((3.0 * MATERIAL_METADATA.metals.co2eFactorPerTon).toFixed(2)),
      createdAt: new Date(now - 1000 * 60 * 60 * 3),
    },
    {
      reservationCode: 'OURO-RES-2026-098X',
      passportId: insertedPassports[6].id,
      hubId: insertedHubs[6].id,
      factoryId: insertedFactories[0].id,
      logisticsProviderId: insertedProviders[1].id,
      driverUserId: driverUser.id,
      quantityTons: 12.0,
      pricePerTonEgp: 10800,
      totalEgp: 129600,
      pickupWindow: 'Completed',
      pickupStatus: 'delivered',
      handoffWeightKg: 11980,
      handoffVerificationMethod: 'ble_scale',
      handoffQrVerified: true,
      handoffGpsLat: insertedHubs[6].lat,
      handoffGpsLng: insertedHubs[6].lng,
      handoffVerifiedAt: new Date(now - 1000 * 60 * 60 * 24 * 5),
      deliveredAt: new Date(now - 1000 * 60 * 60 * 24 * 5),
      co2eAvoidedTons: Number((12.0 * MATERIAL_METADATA.paper_cardboard.co2eFactorPerTon).toFixed(2)),
      createdAt: new Date(now - 1000 * 60 * 60 * 24 * 6),
    },
    {
      reservationCode: 'OURO-RES-2026-095Z',
      passportId: insertedPassports[7].id,
      hubId: insertedHubs[0].id,
      factoryId: insertedFactories[1].id,
      logisticsProviderId: insertedProviders[2].id,
      driverUserId: driverUser.id,
      quantityTons: 8.5,
      pricePerTonEgp: 39200,
      totalEgp: 333200,
      pickupWindow: 'Completed',
      pickupStatus: 'delivered',
      handoffWeightKg: 8510,
      handoffVerificationMethod: 'ble_scale',
      handoffQrVerified: true,
      handoffGpsLat: insertedHubs[0].lat,
      handoffGpsLng: insertedHubs[0].lng,
      handoffVerifiedAt: new Date(now - 1000 * 60 * 60 * 24 * 10),
      deliveredAt: new Date(now - 1000 * 60 * 60 * 24 * 10),
      co2eAvoidedTons: Number((8.5 * MATERIAL_METADATA.metals.co2eFactorPerTon).toFixed(2)),
      createdAt: new Date(now - 1000 * 60 * 60 * 24 * 11),
    },
  ]);

  // 8. Seed Append-Only Passport Events across all 8 Passports
  const eventsToInsert: Array<typeof passportEvents.$inferInsert> = [];
  for (const p of insertedPassports) {
    const hub = insertedHubs.find((h) => h.id === p.hubId)!;
    eventsToInsert.push(
      {
        passportId: p.id,
        stage: 1,
        eventType: 'SOURCE_IDENTIFIED',
        actorName: workerUser.fullName,
        actorRole: 'generator_ops',
        summaryEn: `Lot originated at ${hub.nameEn} (${hub.code}, ${hub.governorate}).`,
        summaryAr: `تم تسجيل مصدر الدفعة في ${hub.nameAr} (${hub.code}).`,
        lat: hub.lat,
        lng: hub.lng,
        createdAt: p.createdAt,
      },
      {
        passportId: p.id,
        stage: 2,
        eventType: 'WEIGHT_CAPTURED',
        actorName: workerUser.fullName,
        actorRole: 'generator_ops',
        summaryEn: `Verified ${(p.initialWeightKg / 1000).toFixed(2)} tons of ${p.materialSubtype} (${p.purityGrade}) via ${p.verificationMethod === 'ble_scale' ? 'Bluetooth Digital Scale' : 'Calibrated Manual Scale'}.`,
        summaryAr: `تم توثيق وزن ${(p.initialWeightKg / 1000).toFixed(2)} طن (${p.purityGrade}) بنجاح.`,
        lat: hub.lat,
        lng: hub.lng,
        createdAt: new Date(p.createdAt.getTime() + 60_000 * 3),
      },
      {
        passportId: p.id,
        stage: 3,
        eventType: 'MARKETPLACE_LISTED',
        actorName: workerUser.fullName,
        actorRole: 'generator_ops',
        summaryEn: `Published to OURO B2B Marketplace at ${p.pricePerTonEgp.toLocaleString()} EGP/ton.`,
        summaryAr: `تم نشر الدفعة في سوق أورو بسعر ${p.pricePerTonEgp.toLocaleString()} ج.م/طن.`,
        lat: hub.lat,
        lng: hub.lng,
        createdAt: new Date(p.createdAt.getTime() + 60_000 * 5),
      }
    );

    if (p.currentStage >= 5) {
      eventsToInsert.push(
        {
          passportId: p.id,
          stage: 4,
          eventType: 'SMART_MATCHED',
          actorName: 'OURO Smart Match Engine',
          actorRole: 'platform_admin',
          summaryEn: `Matched with verified recycling factory based on material affinity and industrial corridor proximity.`,
          summaryAr: `تمت المطابقة الذكية مع مصنع تدوير معتمد بناءً على نوع المادة والقرب الجغرافي.`,
          createdAt: new Date(p.createdAt.getTime() + 60_000 * 35),
        },
        {
          passportId: p.id,
          stage: 5,
          eventType: 'LOT_RESERVED',
          actorName: 'Eng. Tarek El-Masry',
          actorRole: 'factory_procurement',
          summaryEn: `Atomic B2B reservation locked; certified 3PL transport assigned (${insertedProviders[0].envTransportLicenseId}).`,
          summaryAr: `تم تأكيد الحجز التجاري وتعيين شركة نقل بيئي معتمدة.`,
          createdAt: new Date(p.createdAt.getTime() + 60_000 * 60),
        }
      );
    }

    if (p.currentStage >= 6) {
      eventsToInsert.push({
        passportId: p.id,
        stage: 6,
        eventType: 'LOGISTICS_TRACKING',
        actorName: driverUser.fullName,
        actorRole: 'driver_3pl',
        summaryEn: `3PL driver (${insertedProviders[0].nameEn}, License ${insertedProviders[0].envTransportLicenseId}) active on corridor route.`,
        summaryAr: `سائق النقل المعتمد نشط على مسار الاستلام والتسليم.`,
        lat: hub.lat,
        lng: hub.lng,
        createdAt: new Date(p.createdAt.getTime() + 60_000 * 120),
      });
    }

    if (p.currentStage >= 7) {
      eventsToInsert.push({
        passportId: p.id,
        stage: 7,
        eventType: 'ESG_SEALED',
        actorName: 'OURO ESG Carbon Engine',
        actorRole: 'platform_admin',
        summaryEn: `Factory delivery confirmed. Permanently sealed ${p.verifiedCo2eTons.toFixed(2)} tCO2e avoided emissions (Factor: ${p.co2eFactorPerTon} tCO2e/ton).`,
        summaryAr: `تم تأكيد التسليم للمصنع واعتماد توفير ${p.verifiedCo2eTons.toFixed(2)} طن مكافئ CO2.`,
        createdAt: new Date(p.createdAt.getTime() + 60_000 * 240),
      });
    }
  }
  await db.insert(passportEvents).values(eventsToInsert);

  // 9. Seed Admin Audit Log
  await db.insert(adminAuditLogs).values([
    {
      action: 'FACTORY_KYC_APPROVED',
      targetType: 'recycling_factory',
      targetId: String(insertedFactories[0].id),
      actorEmail: 'admin@ouro.eco',
      reason: 'Verified Egyptian Tax Card 304-552-819 and Commercial Registry CR-GIZ-441092.',
    },
    {
      action: 'FACTORY_KYC_APPROVED',
      targetType: 'recycling_factory',
      targetId: String(insertedFactories[1].id),
      actorEmail: 'admin@ouro.eco',
      reason: 'Verified 10th of Ramadan industrial permit and EEAA recycling authorization.',
    },
  ]);

  console.log('OURO pilot dataset seeded successfully.');
}

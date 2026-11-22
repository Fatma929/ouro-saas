import 'dotenv/config';
import http from 'http';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { eq, desc, asc, or, and, gte, ne, sql } from 'drizzle-orm';
import { db } from './src/db/index.ts';
import {
  users,
  wasteSourceHubs,
  recyclingFactories,
  logisticsProviders,
  logisticsVehicles,
  wastePassports,
  reservations,
  passportEvents,
  fileObjects,
  adminAuditLogs,
  emissionFactors,
  disputes,
  idempotencyKeys,
} from './src/db/schema.ts';
import { ensureSeeded } from './src/db/seed.ts';
import {
  requireAuth,
  requireRole,
  resolveUserFromBearer,
  type AuthRequest,
  type AuthenticatedUser,
} from './src/middleware/auth.ts';
import {
  securityHeadersMiddleware,
  createRateLimiter,
  sanitizeCsvCell,
  logStructured,
} from './src/middleware/security.ts';
import {
  ALLOWED_MIME_TYPES,
  VALID_FILE_PURPOSES,
  validateFileMagicBytes,
  storePrivateFile,
  readPrivateFile,
  signFileAccessToken,
  verifyFileAccessToken,
  canUserAccessFile,
} from './src/lib/storage.ts';
import { appendHashedPassportEvents, verifyPassportHashChain } from './src/lib/passport-chain.ts';
import {
  getEmissionFactorForCategory,
  getEmissionFactorMap,
  calculateVerifiedRecyclingImpact,
} from './src/lib/esg-engine.ts';
import {
  dispatchNotification,
  getEmailProviderStatus,
  notifyOrganization,
} from './src/lib/notifications.ts';
import {
  hashPassword,
  verifyPassword,
  signSessionToken,
  generatePassportCode,
  generateReservationCode,
} from './src/lib/auth-utils.ts';
import {
  MATERIAL_METADATA,
  PICKUP_STATUS_FLOW,
  haversineKm,
  type MaterialCategory,
  type HubType,
  type PurityGrade,
  type PickupStatus,
} from './src/shared/constants.ts';
import { platformRouter } from './src/routes/platform-routes.ts';

const app = express();
app.use(securityHeadersMiddleware);
app.use(express.json({ limit: '10mb' }));

// Rate limiters (generous for pilot & automated QA while blocking brute-force abuse)
const authLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60, bucketName: 'auth' });
const uploadLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 40, bucketName: 'upload' });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Allowed: JPEG, PNG, WEBP, PDF, TXT.'));
    }
  },
});

async function hydrateUserProfile(user: typeof users.$inferSelect) {
  const [hub, factory, provider] = await Promise.all([
    user.hubId
      ? db.select().from(wasteSourceHubs).where(eq(wasteSourceHubs.id, user.hubId)).limit(1)
      : Promise.resolve([]),
    user.factoryId
      ? db.select().from(recyclingFactories).where(eq(recyclingFactories.id, user.factoryId)).limit(1)
      : Promise.resolve([]),
    user.logisticsProviderId
      ? db
          .select()
          .from(logisticsProviders)
          .where(eq(logisticsProviders.id, user.logisticsProviderId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  return {
    id: user.id,
    uid: user.uid,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    accountCode: user.accountCode,
    role: user.role,
    isActive: user.isActive,
    hubId: user.hubId,
    factoryId: user.factoryId,
    logisticsProviderId: user.logisticsProviderId,
    language: user.language,
    hub: hub[0] || null,
    factory: factory[0] || null,
    logisticsProvider: provider[0] || null,
  };
}

/**
 * Checks object-level file access including cross-party operational evidence
 * (e.g. generator or buyer factory viewing a 3PL POD or recycling evidence linked to their transaction).
 */
async function canUserAccessFileWithLinks(
  user: AuthenticatedUser | null,
  file: typeof fileObjects.$inferSelect
): Promise<boolean> {
  if (canUserAccessFile(user, file)) return true;
  if (!user) return false;
  if (file.purpose === 'kyc_document') return false;

  // Check if file is linked to a reservation where user's org is generator, buyer factory, or 3PL
  const linkedRes = await db
    .select({
      hubId: reservations.hubId,
      factoryId: reservations.factoryId,
      logisticsProviderId: reservations.logisticsProviderId,
    })
    .from(reservations)
    .where(
      or(
        eq(reservations.podFileId, file.id),
        eq(reservations.weighbridgeFileId, file.id),
        eq(reservations.recyclingEvidenceFileId, file.id)
      )
    )
    .limit(5);

  for (const r of linkedRes) {
    if (user.hubId && r.hubId === user.hubId) return true;
    if (user.factoryId && r.factoryId === user.factoryId) return true;
    if (user.logisticsProviderId && r.logisticsProviderId === user.logisticsProviderId) return true;
  }

  // Check if supporting doc is linked to a passport visible to generator or reserving factory
  const linkedPassport = await db
    .select({ id: wastePassports.id, hubId: wastePassports.hubId })
    .from(wastePassports)
    .where(eq(wastePassports.supportingDocFileId, file.id))
    .limit(1);

  if (linkedPassport.length > 0) {
    if (user.hubId && linkedPassport[0].hubId === user.hubId) return true;
    if (user.factoryId) return true; // Approved buyers inspecting lot spec sheet
  }

  return false;
}

// Middleware to ensure pilot seed & idempotent schema backfills run lazily on first API call
app.use('/api', async (_req, res, next) => {
  try {
    await ensureSeeded();
    next();
  } catch (err) {
    console.error('Database initialization error:', err);
    res.status(503).json({ error: 'Database service temporarily unavailable. Please retry.' });
  }
});

// Mount modular platform routes (3PL vehicles, notifications, disputes, admin governance, health)
app.use(platformRouter);

// ============================================================================
// 1. AUTHENTICATION & FACILITY ONBOARDING ROUTES
// ============================================================================

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { identifier, password, expectedRole } = req.body || {};
    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
      return res.status(400).json({ error: 'Please enter your credentials and password.' });
    }

    const cleanId = identifier.trim();
    const lowerId = cleanId.toLowerCase();

    const matched = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.email, lowerId),
          eq(users.accountCode, cleanId.toUpperCase()),
          eq(users.phone, cleanId)
        )
      )
      .limit(1);

    if (matched.length === 0 || !verifyPassword(password, matched[0].passwordHash)) {
      return res.status(401).json({ error: 'Invalid credentials. Please check your ID/email and password.' });
    }

    const user = matched[0];
    if (!user.isActive) {
      return res.status(403).json({
        error: 'This account has been deactivated by platform administration. Please contact OURO support.',
      });
    }

    if (expectedRole && user.role !== expectedRole) {
      return res.status(403).json({
        error: `This account is registered as "${user.role.replace('_', ' ')}", not "${String(expectedRole).replace('_', ' ')}". Please select the matching portal tab.`,
      });
    }

    const token = signSessionToken({
      uid: user.uid,
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    logStructured('info', 'user_login', { userId: user.id, role: user.role });
    const profile = await hydrateUserProfile(user);
    return res.json({ token, user: profile });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Authentication failed. Please try again.' });
  }
});

app.post('/api/auth/register-factory', authLimiter, upload.single('kycDocument'), async (req, res) => {
  try {
    const {
      factoryName,
      factoryNameAr,
      industrialZone,
      governorate,
      taxId,
      commercialRegNo,
      contactPerson,
      phone,
      email,
      password,
      preferredCategories,
    } = req.body || {};

    if (
      !factoryName ||
      !industrialZone ||
      !taxId ||
      !commercialRegNo ||
      !contactPerson ||
      !phone ||
      !email ||
      !password ||
      String(password).length < 8
    ) {
      return res.status(400).json({
        error: 'All legal KYC fields, contact details, and a password (min 8 chars) are required.',
      });
    }

    if (req.file && !validateFileMagicBytes(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({
        error: 'Uploaded KYC file failed content validation. Please attach a valid PDF, image, or text file.',
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const existing = await db.select().from(users).where(eq(users.email, cleanEmail)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    let parsedCategories: string[] = ['paper_cardboard', 'plastics'];
    if (typeof preferredCategories === 'string' && preferredCategories.trim()) {
      try {
        const arr = JSON.parse(preferredCategories);
        if (Array.isArray(arr) && arr.length > 0) parsedCategories = arr;
      } catch {
        parsedCategories = preferredCategories.split(',').map((s) => s.trim()).filter(Boolean);
      }
    } else if (Array.isArray(preferredCategories) && preferredCategories.length > 0) {
      parsedCategories = preferredCategories;
    }

    let diskFile: { storagePath: string; sha256: string } | null = null;
    if (req.file) {
      diskFile = await storePrivateFile(req.file.buffer, 'kyc_document', req.file.mimetype);
    }

    const result = await db.transaction(async (tx) => {
      const [createdFactory] = await tx
        .insert(recyclingFactories)
        .values({
          nameEn: String(factoryName).trim(),
          nameAr: String(factoryNameAr || factoryName).trim(),
          industrialZone: String(industrialZone).trim(),
          governorate: String(governorate || '6th of October').trim(),
          taxId: String(taxId).trim(),
          commercialRegNo: String(commercialRegNo).trim(),
          contactPerson: String(contactPerson).trim(),
          phone: String(phone).trim(),
          preferredCategories: JSON.stringify(parsedCategories),
          kycStatus: 'pending',
          kycDocumentName: req.file ? req.file.originalname.slice(0, 120) : 'Submitted_KYC_Package.pdf',
        })
        .returning();

      let kycFileId: number | null = null;
      if (req.file && diskFile) {
        const [uploaded] = await tx
          .insert(fileObjects)
          .values({
            originalName: req.file.originalname.slice(0, 120),
            mimeType: req.file.mimetype,
            sizeBytes: req.file.size,
            purpose: 'kyc_document',
            storagePath: diskFile.storagePath,
            sha256: diskFile.sha256,
            dataBase64: '',
            uploadedByUid: `factory-reg-${cleanEmail}`,
            ownerOrgType: 'factory',
            ownerOrgId: createdFactory.id,
            linkedEntityType: 'recycling_factory',
            linkedEntityId: createdFactory.id,
          })
          .returning();
        kycFileId = uploaded.id;
        await tx
          .update(recyclingFactories)
          .set({ kycDocumentFileId: kycFileId })
          .where(eq(recyclingFactories.id, createdFactory.id));
      }

      const uid = `ouro-fac-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
      const accountCode = `FAC-${Math.floor(1000 + Math.random() * 9000)}`;

      const [createdUser] = await tx
        .insert(users)
        .values({
          uid,
          email: cleanEmail,
          passwordHash: hashPassword(String(password)),
          fullName: String(contactPerson).trim(),
          phone: String(phone).trim(),
          accountCode,
          role: 'factory_procurement',
          factoryId: createdFactory.id,
          language: 'en',
        })
        .returning();

      await dispatchNotification(
        {
          targetRole: 'platform_admin',
          type: 'kyc',
          titleEn: 'New Recycling Factory KYC Submission',
          titleAr: 'طلب اعتماد جديد لمصنع إعادة تدوير',
          messageEn: `${createdFactory.nameEn} (Tax ID: ${createdFactory.taxId}) is awaiting KYC review.`,
          messageAr: `مصنع ${createdFactory.nameAr} بانتظار مراجعة مستندات الاعتماد.`,
          entityType: 'recycling_factory',
          entityId: String(createdFactory.id),
        },
        tx
      );

      return { createdUser, createdFactory };
    });

    const token = signSessionToken({
      uid: result.createdUser.uid,
      userId: result.createdUser.id,
      email: result.createdUser.email,
      role: result.createdUser.role,
    });

    const profile = await hydrateUserProfile(result.createdUser);
    return res.status(201).json({ token, user: profile });
  } catch (error) {
    console.error('Factory registration error:', error);
    return res.status(500).json({ error: 'Could not complete factory onboarding. Please try again.' });
  }
});

app.post('/api/auth/register-generator', authLimiter, async (req, res) => {
  try {
    const {
      facilityName,
      facilityNameAr,
      facilityType,
      commercialRegNo,
      governorate,
      address,
      contactPerson,
      phone,
      email,
      password,
      maxCapacityTons,
    } = req.body || {};

    const validTypes: HubType[] = [
      'factory',
      'company',
      'educational_institution',
      'service_institution',
      'hotel',
      'commercial',
    ];

    if (
      !facilityName ||
      !validTypes.includes(facilityType) ||
      !commercialRegNo ||
      !governorate ||
      !address ||
      !contactPerson ||
      !phone ||
      !email ||
      !password ||
      String(password).length < 8
    ) {
      return res.status(400).json({
        error:
          'Facility name, type, commercial registration, address, contact details, and password (min 8 chars) are required.',
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const existing = await db.select().from(users).where(eq(users.email, cleanEmail)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const govCoords: Record<string, [number, number]> = {
      'Greater Cairo': [30.0444, 31.2357],
      Giza: [30.0131, 31.2089],
      '6th of October': [29.9697, 30.9462],
      '10th of Ramadan': [30.3065, 31.7414],
      'Sadat City': [30.3694, 30.5174],
      'Borg El Arab': [30.8927, 29.5522],
    };
    const [lat, lng] = govCoords[String(governorate)] || [30.0444, 31.2357];
    const prefix = String(governorate).slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
    const code = `GEN-${prefix}-${Math.floor(100 + Math.random() * 899)}`;
    const accountCode = `GEN-OPS-${Math.floor(1000 + Math.random() * 8999)}`;
    const uid = `ouro-gen-${Date.now()}-${Math.floor(Math.random() * 9999)}`;

    const result = await db.transaction(async (tx) => {
      const [createdFacility] = await tx
        .insert(wasteSourceHubs)
        .values({
          code,
          nameEn: String(facilityName).trim(),
          nameAr: String(facilityNameAr || facilityName).trim(),
          hubType: facilityType,
          commercialRegNo: String(commercialRegNo).trim(),
          contactPhone: String(phone).trim(),
          governorate: String(governorate).trim(),
          address: String(address).trim(),
          lat,
          lng,
          maxCapacityTons: Number(maxCapacityTons) > 0 ? Number(maxCapacityTons) : 30,
          availableTons: 0,
          reservedTons: 0,
          purityScore: 95.0,
        })
        .returning();

      const [createdUser] = await tx
        .insert(users)
        .values({
          uid,
          email: cleanEmail,
          passwordHash: hashPassword(String(password)),
          fullName: String(contactPerson).trim(),
          phone: String(phone).trim(),
          accountCode,
          role: 'generator_ops',
          hubId: createdFacility.id,
          language: 'en',
        })
        .returning();

      return { createdUser, createdFacility };
    });

    const token = signSessionToken({
      uid: result.createdUser.uid,
      userId: result.createdUser.id,
      email: result.createdUser.email,
      role: result.createdUser.role,
    });

    const profile = await hydrateUserProfile(result.createdUser);
    return res.status(201).json({ token, user: profile });
  } catch (error) {
    console.error('Generator registration error:', error);
    return res.status(500).json({ error: 'Could not register waste generator facility. Please try again.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const rows = await db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const profile = await hydrateUserProfile(rows[0]);
    return res.json({ user: profile });
  } catch (error) {
    console.error('Failed to load profile:', error);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

app.patch('/api/auth/language', requireAuth, async (req: AuthRequest, res) => {
  try {
    const lang = req.body?.language === 'ar' ? 'ar' : 'en';
    await db.update(users).set({ language: lang }).where(eq(users.id, req.authUser!.id));
    return res.json({ language: lang });
  } catch (error) {
    console.error('Language update error:', error);
    return res.status(500).json({ error: 'Failed to update language preference' });
  }
});

// ============================================================================
// 2. PRIVATE FILE STORAGE WITH MAGIC-BYTE VALIDATION, ACLs & SIGNED URLs
// ============================================================================

app.post(
  '/api/storage/upload',
  requireAuth,
  uploadLimiter,
  upload.single('file'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file attached.' });
      }
      if (!validateFileMagicBytes(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({
          error: 'File signature does not match declared MIME type. Upload blocked for security.',
        });
      }

      const requestedPurpose = String(req.body?.purpose || 'weighin_photo');
      const purpose = VALID_FILE_PURPOSES.has(requestedPurpose) ? requestedPurpose : 'weighin_photo';

      const ownerOrgType = req.authUser!.hubId
        ? 'hub'
        : req.authUser!.factoryId
        ? 'factory'
        : req.authUser!.logisticsProviderId
        ? 'logistics_provider'
        : 'admin';
      const ownerOrgId =
        req.authUser!.hubId ?? req.authUser!.factoryId ?? req.authUser!.logisticsProviderId ?? null;

      const diskFile = await storePrivateFile(req.file.buffer, purpose, req.file.mimetype);

      const [stored] = await db
        .insert(fileObjects)
        .values({
          originalName: req.file.originalname.slice(0, 140),
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          purpose,
          storagePath: diskFile.storagePath,
          sha256: diskFile.sha256,
          dataBase64: '',
          uploadedByUid: req.authUser!.uid,
          ownerOrgType,
          ownerOrgId,
        })
        .returning();

      return res.status(201).json({
        id: stored.id,
        url: `/api/storage/${stored.id}`,
        originalName: stored.originalName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        purpose: stored.purpose,
      });
    } catch (error) {
      console.error('Upload error:', error);
      return res.status(500).json({ error: 'File upload failed.' });
    }
  }
);

app.post('/api/storage/:id/sign', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }
    const rows = await db.select().from(fileObjects).where(eq(fileObjects.id, id)).limit(1);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    const file = rows[0];
    const allowed = await canUserAccessFileWithLinks(req.authUser!, file);
    if (!allowed) {
      return res.status(403).json({ error: 'Forbidden: You do not have permission to access this file.' });
    }
    const sig = signFileAccessToken(file.id, req.authUser!.id, 300);
    return res.json({
      signedUrl: `/api/storage/${file.id}?sig=${encodeURIComponent(sig)}`,
      expiresInSeconds: 300,
    });
  } catch (error) {
    console.error('Sign file URL error:', error);
    return res.status(500).json({ error: 'Failed to sign file download URL.' });
  }
});

app.get('/api/storage/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid file ID' });
    }
    const rows = await db.select().from(fileObjects).where(eq(fileObjects.id, id)).limit(1);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    const file = rows[0];

    // Enforce strict verified auth & object-level authorization for ALL non-weighin_photo files
    if (file.purpose !== 'weighin_photo') {
      const sigParam = typeof req.query.sig === 'string' ? req.query.sig : '';
      let authorized = false;

      if (sigParam) {
        const verified = verifyFileAccessToken(file.id, sigParam);
        if (verified) {
          authorized = true;
        }
      }

      if (!authorized) {
        let user: AuthenticatedUser | null = null;
        try {
          user = await resolveUserFromBearer(req.headers.authorization);
        } catch {
          user = null;
        }
        if (!user) {
          return res.status(401).json({ error: 'Unauthorized: Valid authentication or signed token required.' });
        }
        const allowed = await canUserAccessFileWithLinks(user, file);
        if (!allowed) {
          return res.status(403).json({ error: 'Forbidden: Access to this private document is restricted.' });
        }
      }
    }

    let buf: Buffer;
    if (file.storagePath) {
      buf = await readPrivateFile(file.storagePath);
    } else if (file.dataBase64) {
      buf = Buffer.from(file.dataBase64, 'base64');
    } else {
      return res.status(404).json({ error: 'File payload unavailable.' });
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', file.purpose === 'weighin_photo' ? 'private, max-age=3600' : 'no-store');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}"`
    );
    return res.send(buf);
  } catch (error) {
    console.error('Storage download error:', error);
    return res.status(500).json({ error: 'Failed to retrieve file' });
  }
});

// ============================================================================
// 3. WASTE GENERATOR WORKSPACE — INTAKE, EDIT/CANCEL & INCOMING SHIPMENTS
// ============================================================================

app.get(
  '/api/worker/workspace',
  requireAuth,
  requireRole('generator_ops', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const isAdmin = req.authUser!.role === 'platform_admin';
      const allHubs = isAdmin
        ? await db.select().from(wasteSourceHubs).orderBy(asc(wasteSourceHubs.id))
        : req.authUser!.hubId
        ? await db
            .select()
            .from(wasteSourceHubs)
            .where(eq(wasteSourceHubs.id, req.authUser!.hubId))
            .limit(1)
        : [];

      const requestedHubId = Number(req.query.hubId);
      const activeHubId =
        isAdmin && Number.isInteger(requestedHubId) && requestedHubId > 0
          ? requestedHubId
          : req.authUser!.hubId || allHubs[0]?.id;
      const assignedHub = allHubs.find((h) => h.id === activeHubId) || allHubs[0] || null;

      const [hubPassports, incomingResRows] = assignedHub
        ? await Promise.all([
            db
              .select()
              .from(wastePassports)
              .where(eq(wastePassports.hubId, assignedHub.id))
              .orderBy(desc(wastePassports.createdAt))
              .limit(40),
            db
              .select({
                reservation: reservations,
                passport: wastePassports,
                factory: recyclingFactories,
                provider: logisticsProviders,
              })
              .from(reservations)
              .innerJoin(wastePassports, eq(reservations.passportId, wastePassports.id))
              .innerJoin(recyclingFactories, eq(reservations.factoryId, recyclingFactories.id))
              .innerJoin(logisticsProviders, eq(reservations.logisticsProviderId, logisticsProviders.id))
              .where(eq(reservations.hubId, assignedHub.id))
              .orderBy(desc(reservations.createdAt))
              .limit(30),
          ])
        : [[], []];

      const activeNonCancelled = hubPassports.filter((p) => p.status !== 'cancelled');
      const listedTons = Number(
        activeNonCancelled.reduce((sum, p) => sum + p.initialWeightKg / 1000, 0).toFixed(2)
      );
      const deliveredTons = Number(
        activeNonCancelled.reduce((sum, p) => sum + p.deliveredTons, 0).toFixed(2)
      );
      const verifiedRecycledTons = Number(
        activeNonCancelled.reduce((sum, p) => sum + p.recycledTons, 0).toFixed(2)
      );
      const verifiedCo2eTons = Number(
        activeNonCancelled.reduce((sum, p) => sum + p.verifiedCo2eTons, 0).toFixed(2)
      );
      const estimatedCo2eTons = Number(
        activeNonCancelled
          .filter((p) => p.lifecycleStatus !== 'RECYCLED')
          .reduce((sum, p) => sum + (p.initialWeightKg / 1000) * p.co2eFactorPerTon, 0)
          .toFixed(2)
      );

      return res.json({
        assignedHub,
        hubs: allHubs,
        recentPassports: hubPassports,
        incomingReservations: incomingResRows.map((r) => ({
          ...r.reservation,
          passportCode: r.passport.passportCode,
          materialCategory: r.passport.materialCategory,
          materialSubtype: r.passport.materialSubtype,
          purityGrade: r.passport.purityGrade,
          lifecycleStatus: r.passport.lifecycleStatus,
          factoryNameEn: r.factory.nameEn,
          factoryNameAr: r.factory.nameAr,
          providerNameEn: r.provider.nameEn,
          providerLicenseId: r.provider.envTransportLicenseId,
        })),
        facilityEsg: {
          listedTons,
          totalDivertedTons: listedTons,
          deliveredTons,
          verifiedRecycledTons,
          verifiedCo2eTons,
          estimatedCo2eTons,
          projectedCo2eTons: estimatedCo2eTons,
          sealedPassportsCount: activeNonCancelled.filter((p) => p.lifecycleStatus === 'RECYCLED').length,
          deliveredPendingCount: activeNonCancelled.filter((p) => p.lifecycleStatus === 'DELIVERED').length,
          activePassportsCount: activeNonCancelled.filter((p) => p.lifecycleStatus === 'LISTED').length,
        },
      });
    } catch (error) {
      console.error('Generator workspace fetch error:', error);
      return res.status(500).json({ error: 'Failed to load waste generator workspace' });
    }
  }
);

app.post(
  '/api/passports',
  requireAuth,
  requireRole('generator_ops', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const {
        hubId,
        materialCategory,
        materialSubtype,
        purityGrade,
        weightKg,
        pricePerTonEgp,
        verificationMethod,
        photoFileId,
        photoUrl,
        supportingDocFileId,
        supportingDocName,
        notes,
        pickupWindow,
        gpsLat,
        gpsLng,
      } = req.body || {};

      const validCategories: MaterialCategory[] = ['paper_cardboard', 'plastics', 'metals', 'organic'];
      const validGrades: PurityGrade[] = ['Grade A', 'Grade B', 'Grade C'];

      if (!validCategories.includes(materialCategory)) {
        return res.status(400).json({ error: 'Only non-hazardous recyclable materials are permitted.' });
      }
      if (!validGrades.includes(purityGrade)) {
        return res.status(400).json({ error: 'Invalid sorting purity grade.' });
      }

      const numericWeightKg = Number(weightKg);
      if (!Number.isFinite(numericWeightKg) || numericWeightKg < 50 || numericWeightKg > 100_000) {
        return res.status(400).json({ error: 'Weight must be between 50 kg and 100,000 kg.' });
      }

      const weightTons = Number((numericWeightKg / 1000).toFixed(3));
      const meta = MATERIAL_METADATA[materialCategory as MaterialCategory];
      const liveFactor = await getEmissionFactorForCategory(materialCategory);
      const rateEgp = Number(pricePerTonEgp) > 0 ? Number(pricePerTonEgp) : meta.defaultRateEgp;
      const method = verificationMethod === 'ble_scale' ? 'ble_scale' : 'manual_calibrated';

      // Strict organization isolation: generator_ops can ONLY mint lots for their own assigned facility
      const targetHubId =
        req.authUser!.role === 'platform_admin' && Number(hubId) > 0
          ? Number(hubId)
          : req.authUser!.hubId;

      if (!targetHubId) {
        return res.status(400).json({ error: 'A valid Waste Generator facility is required.' });
      }

      const result = await db.transaction(async (tx) => {
        const hubRows = await tx
          .select()
          .from(wasteSourceHubs)
          .where(eq(wasteSourceHubs.id, targetHubId))
          .limit(1);

        if (hubRows.length === 0) {
          throw new Error('HUB_NOT_FOUND');
        }
        const hub = hubRows[0];

        const newAvailableTons = Number((hub.availableTons + weightTons).toFixed(3));
        const passportCode = generatePassportCode();
        const resolvedPhotoUrl =
          photoFileId && Number(photoFileId) > 0
            ? `/api/storage/${Number(photoFileId)}`
            : typeof photoUrl === 'string' && photoUrl.startsWith('/')
            ? photoUrl
            : meta.defaultPhoto;

        const [createdPassport] = await tx
          .insert(wastePassports)
          .values({
            passportCode,
            hubId: hub.id,
            materialCategory,
            materialSubtype: String(materialSubtype || meta.subtypes[0]).trim(),
            purityGrade,
            initialWeightKg: numericWeightKg,
            availableTons: weightTons,
            reservedTons: 0,
            collectedTons: 0,
            deliveredTons: 0,
            recycledTons: 0,
            residualTons: 0,
            rejectedTons: 0,
            pricePerTonEgp: rateEgp,
            verificationMethod: method,
            photoFileId: photoFileId ? Number(photoFileId) : null,
            photoUrl: resolvedPhotoUrl,
            supportingDocFileId: supportingDocFileId ? Number(supportingDocFileId) : null,
            supportingDocName: supportingDocName ? String(supportingDocName).trim().slice(0, 140) : null,
            notes: notes ? String(notes).trim().slice(0, 1000) : null,
            pickupWindow: String(pickupWindow || 'Daily 08:00 - 15:00 EET').trim(),
            currentStage: 3,
            status: 'listed',
            lifecycleStatus: 'LISTED',
            co2eFactorPerTon: liveFactor.co2eFactorPerTon,
            emissionFactorVersion: liveFactor.version,
            verifiedCo2eTons: 0,
            isSampleData: false,
            createdByUserId: req.authUser!.id,
          })
          .returning();

        const [updatedHub] = await tx
          .update(wasteSourceHubs)
          .set({ availableTons: newAvailableTons })
          .where(eq(wasteSourceHubs.id, hub.id))
          .returning();

        const eventLat = Number.isFinite(Number(gpsLat)) ? Number(gpsLat) : hub.lat;
        const eventLng = Number.isFinite(Number(gpsLng)) ? Number(gpsLng) : hub.lng;

        await appendHashedPassportEvents(tx, createdPassport.id, [
          {
            stage: 1,
            eventType: 'SOURCE_IDENTIFIED',
            actorName: req.authUser!.fullName,
            actorRole: req.authUser!.role,
            summaryEn: `Source verified at ${hub.nameEn} (${hub.code}, ${hub.governorate}).`,
            summaryAr: `تم تحديد المصدر في ${hub.nameAr} (${hub.code}، ${hub.governorate}).`,
            lat: eventLat,
            lng: eventLng,
          },
          {
            stage: 2,
            eventType: 'WEIGHT_CAPTURED',
            actorName: req.authUser!.fullName,
            actorRole: req.authUser!.role,
            summaryEn: `Logged ${numericWeightKg.toLocaleString()} kg (${weightTons.toFixed(2)} t) of ${createdPassport.materialSubtype} (${purityGrade}) via ${method === 'ble_scale' ? 'Bluetooth Digital Scale (GATT)' : 'Calibrated Manual Entry'}.`,
            summaryAr: `تم تسجيل وزن ${numericWeightKg.toLocaleString()} كجم (${weightTons.toFixed(2)} طن) بدرجة نقاء ${purityGrade}.`,
            metadataJson: JSON.stringify({ verificationMethod: method, weightKg: numericWeightKg, purityGrade }),
            evidenceFileId: supportingDocFileId ? Number(supportingDocFileId) : photoFileId ? Number(photoFileId) : null,
            lat: eventLat,
            lng: eventLng,
          },
          {
            stage: 3,
            eventType: 'MARKETPLACE_LISTED',
            actorName: req.authUser!.fullName,
            actorRole: req.authUser!.role,
            summaryEn: `Minted Digital Waste Passport ${passportCode} and published ${weightTons.toFixed(2)} t at ${rateEgp.toLocaleString()} EGP/ton (Status: LISTED).`,
            summaryAr: `تم إصدار جواز المخلفات الرقمي ${passportCode} وإدراج ${weightTons.toFixed(2)} طن بسعر ${rateEgp.toLocaleString()} ج.م/طن.`,
            lat: eventLat,
            lng: eventLng,
          },
        ]);

        return { passport: createdPassport, hub: updatedHub };
      });

      return res.status(201).json(result);
    } catch (error: any) {
      if (error?.message === 'HUB_NOT_FOUND') {
        return res.status(404).json({ error: 'Waste generator facility not found.' });
      }
      console.error('Passport minting error:', error);
      return res.status(500).json({ error: 'Failed to mint Digital Waste Passport.' });
    }
  }
);

app.patch(
  '/api/passports/:id',
  requireAuth,
  requireRole('generator_ops', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid passport ID.' });
      }
      const { pricePerTonEgp, purityGrade, pickupWindow, materialSubtype, notes } = req.body || {};

      const updated = await db.transaction(async (tx) => {
        const rows = await tx.select().from(wastePassports).where(eq(wastePassports.id, id)).limit(1);
        if (rows.length === 0) throw new Error('PASSPORT_NOT_FOUND');
        const current = rows[0];

        if (req.authUser!.role !== 'platform_admin' && current.hubId !== req.authUser!.hubId) {
          throw new Error('FORBIDDEN_ORG');
        }
        if (current.status === 'cancelled' || current.lifecycleStatus === 'RECYCLED') {
          throw new Error('CANNOT_EDIT_CLOSED_LOT');
        }

        const updates: Partial<typeof wastePassports.$inferInsert> = { updatedAt: new Date() };
        if (Number(pricePerTonEgp) > 0) updates.pricePerTonEgp = Number(pricePerTonEgp);
        if (['Grade A', 'Grade B', 'Grade C'].includes(purityGrade)) updates.purityGrade = purityGrade;
        if (typeof pickupWindow === 'string' && pickupWindow.trim()) updates.pickupWindow = pickupWindow.trim();
        if (typeof materialSubtype === 'string' && materialSubtype.trim()) {
          updates.materialSubtype = materialSubtype.trim();
        }
        if (typeof notes === 'string') updates.notes = notes.trim().slice(0, 1000);

        const [saved] = await tx
          .update(wastePassports)
          .set(updates)
          .where(eq(wastePassports.id, id))
          .returning();

        await appendHashedPassportEvents(tx, saved.id, [
          {
            stage: saved.currentStage,
            eventType: 'LISTING_UPDATED',
            actorName: req.authUser!.fullName,
            actorRole: req.authUser!.role,
            summaryEn: `Listing parameters updated (${saved.purityGrade}, ${saved.pricePerTonEgp.toLocaleString()} EGP/t, window: ${saved.pickupWindow}).`,
            summaryAr: `تم تحديث بيانات الدفعة (${saved.purityGrade}، ${saved.pricePerTonEgp.toLocaleString()} ج.م/طن).`,
          },
        ]);

        return saved;
      });

      return res.json({ passport: updated });
    } catch (error: any) {
      if (error?.message === 'PASSPORT_NOT_FOUND') return res.status(404).json({ error: 'Passport not found.' });
      if (error?.message === 'FORBIDDEN_ORG') {
        return res.status(403).json({ error: 'Forbidden: You can only edit listings belonging to your facility.' });
      }
      if (error?.message === 'CANNOT_EDIT_CLOSED_LOT') {
        return res.status(409).json({ error: 'Cancelled or verified recycled lots cannot be edited.' });
      }
      console.error('Update passport error:', error);
      return res.status(500).json({ error: 'Failed to update waste listing.' });
    }
  }
);

app.delete(
  '/api/passports/:id',
  requireAuth,
  requireRole('generator_ops', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid passport ID.' });
      }

      const cancelled = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM waste_passports WHERE id = ${id} FOR UPDATE`);
        const rows = await tx.select().from(wastePassports).where(eq(wastePassports.id, id)).limit(1);
        if (rows.length === 0) throw new Error('PASSPORT_NOT_FOUND');
        const current = rows[0];

        if (req.authUser!.role !== 'platform_admin' && current.hubId !== req.authUser!.hubId) {
          throw new Error('FORBIDDEN_ORG');
        }
        if (current.reservedTons > 0 || current.deliveredTons > 0 || current.recycledTons > 0) {
          throw new Error('LOT_HAS_ACTIVE_ALLOCATIONS');
        }
        if (current.status === 'cancelled') {
          return current;
        }

        const [hub] = await tx
          .select()
          .from(wasteSourceHubs)
          .where(eq(wasteSourceHubs.id, current.hubId))
          .limit(1);

        if (hub) {
          await tx
            .update(wasteSourceHubs)
            .set({ availableTons: Math.max(0, Number((hub.availableTons - current.availableTons).toFixed(3))) })
            .where(eq(wasteSourceHubs.id, hub.id));
        }

        const [saved] = await tx
          .update(wastePassports)
          .set({
            availableTons: 0,
            status: 'cancelled',
            updatedAt: new Date(),
          })
          .where(eq(wastePassports.id, id))
          .returning();

        await appendHashedPassportEvents(tx, saved.id, [
          {
            stage: saved.currentStage,
            eventType: 'LISTING_CANCELLED',
            actorName: req.authUser!.fullName,
            actorRole: req.authUser!.role,
            summaryEn: `Unreserved listing cancelled by ${req.authUser!.fullName}; ${current.availableTons.toFixed(2)} t removed from marketplace.`,
            summaryAr: `تم إلغاء الدفعة غير المحجوزة وإزالتها من السوق.`,
          },
        ]);

        return saved;
      });

      return res.json({ passport: cancelled });
    } catch (error: any) {
      if (error?.message === 'PASSPORT_NOT_FOUND') return res.status(404).json({ error: 'Passport not found.' });
      if (error?.message === 'FORBIDDEN_ORG') {
        return res.status(403).json({ error: 'Forbidden: You can only cancel listings belonging to your facility.' });
      }
      if (error?.message === 'LOT_HAS_ACTIVE_ALLOCATIONS') {
        return res.status(409).json({
          error: 'Cannot cancel a lot that has reserved, delivered, or recycled tonnage.',
        });
      }
      console.error('Cancel passport error:', error);
      return res.status(500).json({ error: 'Failed to cancel waste listing.' });
    }
  }
);

app.get(
  '/api/generator/transactions.csv',
  requireAuth,
  requireRole('generator_ops', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const scope =
        req.authUser!.role === 'generator_ops' && req.authUser!.hubId
          ? eq(wastePassports.hubId, req.authUser!.hubId)
          : undefined;

      const rows = scope
        ? await db.select().from(wastePassports).where(scope).orderBy(desc(wastePassports.createdAt))
        : await db.select().from(wastePassports).orderBy(desc(wastePassports.createdAt));

      const headers = [
        'Passport_Code',
        'Lifecycle_Status',
        'Material_Category',
        'Subtype',
        'Purity_Grade',
        'Initial_Tons',
        'Available_Tons',
        'Reserved_Tons',
        'Delivered_Tons',
        'Verified_Recycled_Tons',
        'Residual_Tons',
        'Loss_Tons',
        'Price_Per_Ton_EGP',
        'Verified_Net_CO2e_Tons',
        'Created_At_UTC',
      ];
      const lines = [headers.join(',')];
      for (const p of rows) {
        lines.push(
          [
            p.passportCode,
            p.lifecycleStatus,
            p.materialCategory,
            p.materialSubtype,
            p.purityGrade,
            Number((p.initialWeightKg / 1000).toFixed(3)),
            p.availableTons,
            p.reservedTons,
            p.deliveredTons,
            p.recycledTons,
            p.residualTons,
            p.rejectedTons,
            p.pricePerTonEgp,
            p.verifiedCo2eTons,
            new Date(p.createdAt).toISOString(),
          ]
            .map(sanitizeCsvCell)
            .join(',')
        );
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="OURO_Generator_Waste_Ledger_${new Date().toISOString().slice(0, 10)}.csv"`
      );
      return res.send(lines.join('\n'));
    } catch (error) {
      console.error('Generator CSV export error:', error);
      return res.status(500).json({ error: 'Failed to export generator waste ledger.' });
    }
  }
);

// ============================================================================
// 4. DIGITAL WASTE PASSPORT DETAIL & SHA-256 TAMPER-EVIDENT CHAIN VERIFICATION
// ============================================================================

app.get('/api/passports/:codeOrId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const param = String(req.params.codeOrId).trim();
    const numericId = Number(param);
    const passportRows = await db
      .select()
      .from(wastePassports)
      .where(
        Number.isInteger(numericId) && numericId > 0
          ? eq(wastePassports.id, numericId)
          : eq(wastePassports.passportCode, param.toUpperCase())
      )
      .limit(1);

    if (passportRows.length === 0) {
      return res.status(404).json({ error: 'Digital Waste Passport not found.' });
    }
    const passport = passportRows[0];

    const [hubRows, eventsById, linkedReservations, liveFactor] = await Promise.all([
      db.select().from(wasteSourceHubs).where(eq(wasteSourceHubs.id, passport.hubId)).limit(1),
      db
        .select()
        .from(passportEvents)
        .where(eq(passportEvents.passportId, passport.id))
        .orderBy(asc(passportEvents.id)),
      db
        .select({
          reservation: reservations,
          factory: recyclingFactories,
          provider: logisticsProviders,
        })
        .from(reservations)
        .innerJoin(recyclingFactories, eq(reservations.factoryId, recyclingFactories.id))
        .innerJoin(logisticsProviders, eq(reservations.logisticsProviderId, logisticsProviders.id))
        .where(eq(reservations.passportId, passport.id))
        .orderBy(desc(reservations.createdAt)),
      getEmissionFactorForCategory(passport.materialCategory),
    ]);

    const chainIntegrity = verifyPassportHashChain(eventsById);
    const user = req.authUser!;

    // Scope financial details on linked reservations to authorized supply-chain parties
    const scopedReservations = linkedReservations.map((r) => {
      const canViewCommercial =
        user.role === 'platform_admin' ||
        user.hubId === r.reservation.hubId ||
        user.factoryId === r.reservation.factoryId ||
        user.logisticsProviderId === r.reservation.logisticsProviderId;

      return {
        ...r.reservation,
        totalEgp: canViewCommercial ? r.reservation.totalEgp : null,
        factoryNameEn: r.factory.nameEn,
        factoryNameAr: r.factory.nameAr,
        logisticsProviderNameEn: r.provider.nameEn,
        logisticsProviderLicense: r.provider.envTransportLicenseId,
      };
    });

    return res.json({
      passport,
      hub: hubRows[0] || null,
      events: eventsById,
      chainIntegrity,
      reconciliation: {
        initialTons: Number((passport.initialWeightKg / 1000).toFixed(3)),
        availableTons: passport.availableTons,
        reservedTons: passport.reservedTons,
        collectedTons: passport.collectedTons,
        deliveredTons: passport.deliveredTons,
        recycledTons: passport.recycledTons,
        residualTons: passport.residualTons,
        rejectedTons: passport.rejectedTons,
      },
      emissionFactor: liveFactor,
      reservations: scopedReservations,
    });
  } catch (error) {
    console.error('Passport lookup error:', error);
    return res.status(500).json({ error: 'Failed to retrieve Digital Waste Passport.' });
  }
});

// ============================================================================
// 5. RECYCLING FACTORY MARKETPLACE, PROFILE, ATOMIC RESERVATIONS & RECYCLING VERIFICATION
// ============================================================================

app.get('/api/marketplace/lots', requireAuth, async (req: AuthRequest, res) => {
  try {
    const [allLots, allHubs, factoryRows, factoryResRows] = await Promise.all([
      db
        .select({
          passport: wastePassports,
          hub: wasteSourceHubs,
        })
        .from(wastePassports)
        .innerJoin(wasteSourceHubs, eq(wastePassports.hubId, wasteSourceHubs.id))
        .where(and(gte(wastePassports.availableTons, 0.5), ne(wastePassports.status, 'cancelled')))
        .orderBy(desc(wastePassports.createdAt)),
      db.select().from(wasteSourceHubs),
      req.authUser!.factoryId
        ? db
            .select()
            .from(recyclingFactories)
            .where(eq(recyclingFactories.id, req.authUser!.factoryId))
            .limit(1)
        : Promise.resolve([]),
      req.authUser!.factoryId
        ? db
            .select()
            .from(reservations)
            .where(eq(reservations.factoryId, req.authUser!.factoryId))
        : db.select().from(reservations),
    ]);

    const factory = factoryRows[0] || null;
    let preferredCats: string[] = ['paper_cardboard', 'plastics'];
    if (factory?.preferredCategories) {
      try {
        preferredCats = JSON.parse(factory.preferredCategories);
      } catch {
        preferredCats = ['paper_cardboard', 'plastics'];
      }
    }
    const factoryLat = factory?.lat ?? 29.9697;
    const factoryLng = factory?.lng ?? 30.9462;

    const lotsWithSmartMatch = allLots.map(({ passport, hub }) => {
      const distanceKm = Number(haversineKm(factoryLat, factoryLng, hub.lat, hub.lng).toFixed(1));
      let score = 45;
      if (preferredCats.includes(passport.materialCategory)) score += 28;
      if (passport.purityGrade === 'Grade A') score += 14;
      else if (passport.purityGrade === 'Grade B') score += 7;
      if (distanceKm <= 25) score += 11;
      else if (distanceKm <= 55) score += 7;
      else if (distanceKm <= 90) score += 3;
      if (passport.availableTons >= 5) score += 2;
      const smartMatchScore = Math.min(99, Math.max(52, Math.round(score)));

      return {
        ...passport,
        hub: {
          id: hub.id,
          code: hub.code,
          nameEn: hub.nameEn,
          nameAr: hub.nameAr,
          hubType: hub.hubType,
          governorate: hub.governorate,
          address: hub.address,
          lat: hub.lat,
          lng: hub.lng,
          maxCapacityTons: hub.maxCapacityTons,
          availableTons: hub.availableTons,
          reservedTons: hub.reservedTons,
          purityScore: hub.purityScore,
        },
        distanceKm,
        smartMatchScore,
        matchReasons: [
          preferredCats.includes(passport.materialCategory) ? 'Target Material Affinity' : null,
          passport.purityGrade === 'Grade A' ? 'Grade A Purity Verified' : null,
          distanceKm <= 45 ? `${distanceKm} km Corridor Proximity` : null,
        ].filter(Boolean),
      };
    });

    const totalAvailableTons = Number(
      lotsWithSmartMatch.reduce((acc, l) => acc + l.availableTons, 0).toFixed(2)
    );
    const activeHubsCount = allHubs.filter((h) => h.isActive).length;
    const activeReservationsCount = factoryResRows.filter(
      (r) => r.pickupStatus !== 'delivered' && r.pickupStatus !== 'cancelled'
    ).length;
    const deliveredPendingTons = Number(
      factoryResRows
        .filter((r) => r.pickupStatus === 'delivered' && r.recyclingStatus !== 'verified_recycled')
        .reduce((acc, r) => acc + (r.receivedWeightKg ? r.receivedWeightKg / 1000 : r.quantityTons), 0)
        .toFixed(2)
    );
    const verifiedRecycledTons = Number(
      factoryResRows
        .filter((r) => r.recyclingStatus === 'verified_recycled')
        .reduce((acc, r) => acc + r.recoveredTons, 0)
        .toFixed(2)
    );
    const verifiedCo2eTons = Number(
      factoryResRows
        .filter((r) => r.recyclingStatus === 'verified_recycled')
        .reduce((acc, r) => acc + r.co2eAvoidedTons, 0)
        .toFixed(2)
    );

    return res.json({
      factory,
      kpis: {
        totalAvailableTons,
        activeHubsCount,
        activeReservationsCount,
        deliveredPendingTons,
        verifiedRecycledTons,
        verifiedCo2eTons,
      },
      lots: lotsWithSmartMatch,
      smartMatches: [...lotsWithSmartMatch]
        .filter((l) => l.availableTons >= 1)
        .sort((a, b) => b.smartMatchScore - a.smartMatchScore)
        .slice(0, 3),
    });
  } catch (error) {
    console.error('Marketplace fetch error:', error);
    return res.status(500).json({ error: 'Failed to load B2B marketplace lots.' });
  }
});

app.patch(
  '/api/factory/profile',
  requireAuth,
  requireRole('factory_procurement', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const factoryId = req.authUser!.factoryId || Number(req.body?.factoryId);
      if (!factoryId) {
        return res.status(400).json({ error: 'No recycling facility linked to this account.' });
      }
      const { preferredCategories, monthlyCapacityTons, acceptedGrades, procurementNotes } = req.body || {};

      const updates: Partial<typeof recyclingFactories.$inferInsert> = {};
      if (Array.isArray(preferredCategories) && preferredCategories.length > 0) {
        updates.preferredCategories = JSON.stringify(preferredCategories);
      }
      if (Number(monthlyCapacityTons) > 0) {
        updates.monthlyCapacityTons = Number(monthlyCapacityTons);
      }
      if (Array.isArray(acceptedGrades) && acceptedGrades.length > 0) {
        updates.acceptedGrades = JSON.stringify(acceptedGrades);
      }
      if (typeof procurementNotes === 'string') {
        updates.procurementNotes = procurementNotes.trim().slice(0, 1000);
      }

      const [saved] = await db
        .update(recyclingFactories)
        .set(updates)
        .where(eq(recyclingFactories.id, factoryId))
        .returning();

      if (!saved) return res.status(404).json({ error: 'Recycling facility not found.' });
      return res.json({ factory: saved });
    } catch (error) {
      console.error('Update factory profile error:', error);
      return res.status(500).json({ error: 'Failed to update recycling facility profile.' });
    }
  }
);

app.get(
  '/api/factory/reservations',
  requireAuth,
  requireRole('factory_procurement', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const query = db
        .select({
          reservation: reservations,
          passport: wastePassports,
          hub: wasteSourceHubs,
          provider: logisticsProviders,
        })
        .from(reservations)
        .innerJoin(wastePassports, eq(reservations.passportId, wastePassports.id))
        .innerJoin(wasteSourceHubs, eq(reservations.hubId, wasteSourceHubs.id))
        .innerJoin(logisticsProviders, eq(reservations.logisticsProviderId, logisticsProviders.id))
        .orderBy(desc(reservations.createdAt));

      const rows = req.authUser!.factoryId
        ? await query.where(eq(reservations.factoryId, req.authUser!.factoryId))
        : await query;

      return res.json({
        reservations: rows.map((r) => ({
          ...r.reservation,
          passportCode: r.passport.passportCode,
          materialCategory: r.passport.materialCategory,
          materialSubtype: r.passport.materialSubtype,
          purityGrade: r.passport.purityGrade,
          currentStage: r.passport.currentStage,
          lifecycleStatus: r.passport.lifecycleStatus,
          co2eFactorPerTon: r.passport.co2eFactorPerTon,
          hubNameEn: r.hub.nameEn,
          hubNameAr: r.hub.nameAr,
          hubGovernorate: r.hub.governorate,
          providerNameEn: r.provider.nameEn,
          providerLicenseId: r.provider.envTransportLicenseId,
        })),
      });
    } catch (error) {
      console.error('Factory reservations fetch error:', error);
      return res.status(500).json({ error: 'Failed to load factory reservations.' });
    }
  }
);

app.post(
  '/api/reservations',
  requireAuth,
  requireRole('factory_procurement', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const { passportId, quantityTons, pickupWindow } = req.body || {};
      const qty = Number(quantityTons);
      const pId = Number(passportId);

      if (!Number.isInteger(pId) || pId <= 0) {
        return res.status(400).json({ error: 'Invalid Digital Waste Passport ID.' });
      }
      if (!Number.isFinite(qty) || qty < 1) {
        return res.status(400).json({ error: 'Minimum B2B reservation quantity is 1.0 metric ton.' });
      }

      // Optional Idempotency-Key deduplication
      const idempotencyHeader = req.headers['idempotency-key'];
      const idemKey =
        typeof idempotencyHeader === 'string' && idempotencyHeader.trim().length >= 8
          ? idempotencyHeader.trim().slice(0, 128)
          : null;

      if (idemKey) {
        const existingIdem = await db
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.key, idemKey),
              eq(idempotencyKeys.userId, req.authUser!.id),
              eq(idempotencyKeys.endpoint, 'POST /api/reservations')
            )
          )
          .limit(1);
        if (existingIdem.length > 0) {
          return res.status(existingIdem[0].statusCode).json(JSON.parse(existingIdem[0].responseJson));
        }
      }

      const result = await db.transaction(async (tx) => {
        // 1. Strict Backend Factory KYC Gate
        let factoryId = req.authUser!.factoryId;
        if (!factoryId && req.authUser!.role === 'platform_admin') {
          const approvedFac = await tx
            .select()
            .from(recyclingFactories)
            .where(eq(recyclingFactories.kycStatus, 'approved'))
            .limit(1);
          factoryId = approvedFac[0]?.id ?? null;
        }
        if (!factoryId) throw new Error('NO_FACTORY_LINKED');

        const factoryRows = await tx
          .select()
          .from(recyclingFactories)
          .where(eq(recyclingFactories.id, factoryId))
          .limit(1);

        if (factoryRows.length === 0) throw new Error('NO_FACTORY_LINKED');
        const factory = factoryRows[0];
        if (factory.kycStatus !== 'approved') throw new Error('FACTORY_KYC_NOT_APPROVED');

        // 2. PostgreSQL Row-Level Exclusive Lock (SELECT ... FOR UPDATE) prevents double-booking under concurrency
        await tx.execute(sql`SELECT id FROM waste_passports WHERE id = ${pId} FOR UPDATE`);

        const passportRows = await tx
          .select()
          .from(wastePassports)
          .where(eq(wastePassports.id, pId))
          .limit(1);

        if (passportRows.length === 0) throw new Error('PASSPORT_NOT_FOUND');
        const passport = passportRows[0];
        if (passport.status === 'cancelled') throw new Error('LOT_CANCELLED');

        if (qty > passport.availableTons + 0.0001) {
          throw new Error(`INSUFFICIENT_STOCK:${passport.availableTons}`);
        }

        await tx.execute(sql`SELECT id FROM waste_source_hubs WHERE id = ${passport.hubId} FOR UPDATE`);
        const [hub] = await tx
          .select()
          .from(wasteSourceHubs)
          .where(eq(wasteSourceHubs.id, passport.hubId))
          .limit(1);

        // 3. Assign verified external 3PL provider & driver (asset-light model)
        const providers = await tx
          .select()
          .from(logisticsProviders)
          .where(eq(logisticsProviders.isVerified, true))
          .orderBy(desc(logisticsProviders.onTimeRate));
        const provider = providers[0];
        if (!provider) throw new Error('NO_3PL_AVAILABLE');

        const drivers = await tx
          .select()
          .from(users)
          .where(and(eq(users.role, 'driver_3pl'), eq(users.logisticsProviderId, provider.id)))
          .limit(1);
        const driver = drivers[0] || null;

        // 4. Conditional atomic stock decrement (defense-in-depth against race conditions)
        const nextPassportAvailable = Math.max(0, Number((passport.availableTons - qty).toFixed(3)));
        const nextPassportReserved = Number((passport.reservedTons + qty).toFixed(3));
        const updatedPassports = await tx
          .update(wastePassports)
          .set({
            availableTons: nextPassportAvailable,
            reservedTons: nextPassportReserved,
            currentStage: Math.max(passport.currentStage, 5),
            status: passport.currentStage >= 6 ? passport.status : 'reserved',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(wastePassports.id, passport.id),
              gte(wastePassports.availableTons, qty - 0.0001)
            )
          )
          .returning();

        if (updatedPassports.length === 0) {
          throw new Error(`INSUFFICIENT_STOCK:${passport.availableTons}`);
        }

        await tx
          .update(wasteSourceHubs)
          .set({
            availableTons: Math.max(0, Number((hub.availableTons - qty).toFixed(3))),
            reservedTons: Number((hub.reservedTons + qty).toFixed(3)),
          })
          .where(eq(wasteSourceHubs.id, hub.id));

        const liveFactor = await getEmissionFactorForCategory(passport.materialCategory);
        const corridorDistanceKm = Number(haversineKm(hub.lat, hub.lng, factory.lat, factory.lng).toFixed(1));
        const estTransportEmissions = Number(
          ((qty * corridorDistanceKm * liveFactor.transportFactorKgPerTonKm) / 1000).toFixed(3)
        );
        const estimatedCo2e = Number(
          Math.max(0, qty * liveFactor.co2eFactorPerTon - estTransportEmissions).toFixed(3)
        );
        const totalEgp = Number((qty * passport.pricePerTonEgp).toFixed(2));
        const reservationCode = generateReservationCode();
        const expiresAt = new Date(Date.now() + 72 * 3600 * 1000);

        const [createdRes] = await tx
          .insert(reservations)
          .values({
            reservationCode,
            passportId: passport.id,
            hubId: hub.id,
            factoryId: factory.id,
            logisticsProviderId: provider.id,
            driverUserId: driver?.id ?? null,
            quantityTons: qty,
            pricePerTonEgp: passport.pricePerTonEgp,
            totalEgp,
            pickupWindow: String(pickupWindow || passport.pickupWindow).trim(),
            pickupStatus: 'scheduled',
            receiptStatus: 'pending',
            recyclingStatus: 'pending_recycling',
            transportDistanceKm: corridorDistanceKm,
            transportEmissionsTons: estTransportEmissions,
            estimatedCo2eTons: estimatedCo2e,
            co2eAvoidedTons: 0, // Strictly 0 until verified recycling at Stage 7!
            esgConfidenceLevel: 'estimated',
            expiresAt,
          })
          .returning();

        await appendHashedPassportEvents(tx, passport.id, [
          {
            stage: 4,
            eventType: 'SMART_MATCHED',
            actorName: 'OURO Smart Match Engine',
            actorRole: 'platform_admin',
            summaryEn: `Matched lot with verified buyer ${factory.nameEn} (${factory.industrialZone}, ${corridorDistanceKm} km corridor).`,
            summaryAr: `تمت المطابقة مع المصنع المعتمد ${factory.nameAr} (${corridorDistanceKm} كم).`,
          },
          {
            stage: 5,
            eventType: 'LOT_RESERVED',
            actorName: req.authUser!.fullName,
            actorRole: req.authUser!.role,
            summaryEn: `Reserved ${qty.toFixed(2)} tons (${totalEgp.toLocaleString()} EGP). Dispatched to external 3PL ${provider.nameEn} (License ${provider.envTransportLicenseId}).`,
            summaryAr: `تم حجز ${qty.toFixed(2)} طن بقيمة ${totalEgp.toLocaleString()} ج.م وتعيين شركة النقل ${provider.nameAr}.`,
            metadataJson: JSON.stringify({
              reservationCode,
              quantityTons: qty,
              totalEgp,
              corridorDistanceKm,
              logisticsLicense: provider.envTransportLicenseId,
            }),
          },
        ]);

        await notifyOrganization(
          { hubId: hub.id },
          {
            type: 'reservation',
            titleEn: `New Reservation (${reservationCode})`,
            titleAr: `حجز جديد للدفعة (${reservationCode})`,
            messageEn: `${factory.nameEn} reserved ${qty.toFixed(2)} t from ${passport.passportCode}. 3PL: ${provider.nameEn}.`,
            messageAr: `قام مصنع ${factory.nameAr} بحجز ${qty.toFixed(2)} طن من الدفعة ${passport.passportCode}.`,
            entityType: 'passport',
            entityId: passport.passportCode,
          },
          tx
        );

        await notifyOrganization(
          { logisticsProviderId: provider.id },
          {
            type: 'shipment',
            titleEn: `New 3PL Dispatch Assigned (${reservationCode})`,
            titleAr: `تكليف نقل بيئي جديد (${reservationCode})`,
            messageEn: `Collect ${qty.toFixed(2)} t from ${hub.nameEn} and deliver to ${factory.nameEn}.`,
            messageAr: `استلام ${qty.toFixed(2)} طن من ${hub.nameAr} والتسليم إلى ${factory.nameAr}.`,
            entityType: 'reservation',
            entityId: String(createdRes.id),
          },
          tx
        );

        const payload = { reservation: createdRes, provider, passportCode: passport.passportCode };
        if (idemKey) {
          await tx
            .insert(idempotencyKeys)
            .values({
              key: idemKey,
              userId: req.authUser!.id,
              endpoint: 'POST /api/reservations',
              statusCode: 201,
              responseJson: JSON.stringify(payload),
            })
            .onConflictDoNothing();
        }
        return payload;
      });

      return res.status(201).json(result);
    } catch (error: any) {
      const msg = String(error?.message || '');
      if (msg === 'FACTORY_KYC_NOT_APPROVED') {
        return res.status(403).json({
          error:
            'Verification Pending: Your recycling factory KYC documents must be approved by an OURO Admin before reserving material.',
        });
      }
      if (msg === 'PASSPORT_NOT_FOUND') {
        return res.status(404).json({ error: 'Selected material lot no longer exists.' });
      }
      if (msg === 'LOT_CANCELLED') {
        return res.status(409).json({ error: 'This listing has been cancelled.' });
      }
      if (msg.startsWith('INSUFFICIENT_STOCK:')) {
        const avail = msg.split(':')[1];
        return res.status(409).json({
          error: `Requested quantity exceeds current verified availability (${avail} tons remaining).`,
        });
      }
      console.error('Reservation error:', error);
      return res.status(500).json({ error: 'Could not complete reservation transaction.' });
    }
  }
);

app.post(
  '/api/reservations/:id/cancel',
  requireAuth,
  requireRole('factory_procurement', 'generator_ops', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const resId = Number(req.params.id);
      const cancelReason =
        typeof req.body?.reason === 'string' && req.body.reason.trim()
          ? req.body.reason.trim().slice(0, 300)
          : 'Cancelled prior to physical pickup.';

      if (!Number.isInteger(resId) || resId <= 0) {
        return res.status(400).json({ error: 'Invalid reservation ID.' });
      }

      const updated = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM reservations WHERE id = ${resId} FOR UPDATE`);
        const rows = await tx.select().from(reservations).where(eq(reservations.id, resId)).limit(1);
        if (rows.length === 0) throw new Error('RESERVATION_NOT_FOUND');
        const current = rows[0];

        const isOwner =
          req.authUser!.role === 'platform_admin' ||
          (req.authUser!.factoryId && current.factoryId === req.authUser!.factoryId) ||
          (req.authUser!.hubId && current.hubId === req.authUser!.hubId);
        if (!isOwner) throw new Error('FORBIDDEN_ORG');

        if (current.pickupStatus === 'cancelled') throw new Error('ALREADY_CANCELLED');
        if (current.pickupStatus === 'picked_up' || current.pickupStatus === 'delivered') {
          throw new Error('CANNOT_CANCEL_AFTER_PICKUP');
        }

        await tx.execute(sql`SELECT id FROM waste_passports WHERE id = ${current.passportId} FOR UPDATE`);
        await tx.execute(sql`SELECT id FROM waste_source_hubs WHERE id = ${current.hubId} FOR UPDATE`);

        const [passport] = await tx
          .select()
          .from(wastePassports)
          .where(eq(wastePassports.id, current.passportId))
          .limit(1);
        const [hub] = await tx
          .select()
          .from(wasteSourceHubs)
          .where(eq(wasteSourceHubs.id, current.hubId))
          .limit(1);

        const restoredPassportAvailable = Number((passport.availableTons + current.quantityTons).toFixed(3));
        const restoredPassportReserved = Math.max(0, Number((passport.reservedTons - current.quantityTons).toFixed(3)));

        await tx
          .update(wastePassports)
          .set({
            availableTons: restoredPassportAvailable,
            reservedTons: restoredPassportReserved,
            status: restoredPassportReserved === 0 && passport.deliveredTons === 0 ? 'listed' : passport.status,
            updatedAt: new Date(),
          })
          .where(eq(wastePassports.id, passport.id));

        await tx
          .update(wasteSourceHubs)
          .set({
            availableTons: Number((hub.availableTons + current.quantityTons).toFixed(3)),
            reservedTons: Math.max(0, Number((hub.reservedTons - current.quantityTons).toFixed(3))),
          })
          .where(eq(wasteSourceHubs.id, hub.id));

        const [savedRes] = await tx
          .update(reservations)
          .set({
            pickupStatus: 'cancelled',
            cancelledAt: new Date(),
            cancelReason,
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, current.id))
          .returning();

        await appendHashedPassportEvents(tx, passport.id, [
          {
            stage: passport.currentStage,
            eventType: 'RESERVATION_CANCELLED',
            actorName: req.authUser!.fullName,
            actorRole: req.authUser!.role,
            summaryEn: `Reservation ${current.reservationCode} (${current.quantityTons.toFixed(2)} t) cancelled. Stock atomically released back to marketplace. Reason: ${cancelReason}`,
            summaryAr: `تم إلغاء الحجز ${current.reservationCode} وإعادة ${current.quantityTons.toFixed(2)} طن للمخزون المتاح.`,
            metadataJson: JSON.stringify({ reservationCode: current.reservationCode, restoredTons: current.quantityTons }),
          },
        ]);

        await notifyOrganization(
          { hubId: current.hubId },
          {
            type: 'reservation',
            titleEn: `Reservation Cancelled (${current.reservationCode})`,
            titleAr: `إلغاء حجز (${current.reservationCode})`,
            messageEn: `${current.quantityTons.toFixed(2)} t released back to available inventory. ${cancelReason}`,
            messageAr: `تمت إعادة ${current.quantityTons.toFixed(2)} طن إلى المخزون المتاح.`,
            entityType: 'passport',
            entityId: passport.passportCode,
          },
          tx
        );

        return savedRes;
      });

      return res.json({ reservation: updated });
    } catch (error: any) {
      const msg = String(error?.message || '');
      if (msg === 'RESERVATION_NOT_FOUND') return res.status(404).json({ error: 'Reservation not found.' });
      if (msg === 'FORBIDDEN_ORG') return res.status(403).json({ error: 'Forbidden: Not authorized for this reservation.' });
      if (msg === 'ALREADY_CANCELLED') return res.status(409).json({ error: 'Reservation is already cancelled.' });
      if (msg === 'CANNOT_CANCEL_AFTER_PICKUP') {
        return res.status(409).json({ error: 'Cannot cancel a shipment after physical 3PL pickup has occurred.' });
      }
      console.error('Cancel reservation error:', error);
      return res.status(500).json({ error: 'Failed to cancel reservation.' });
    }
  }
);

app.post(
  '/api/reservations/:id/receive',
  requireAuth,
  requireRole('factory_procurement', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const resId = Number(req.params.id);
      const { receivedWeightKg, weighbridgeFileId, weighbridgeFileName } = req.body || {};

      if (!Number.isInteger(resId) || resId <= 0) {
        return res.status(400).json({ error: 'Invalid reservation ID.' });
      }
      const weightKgNum = Number(receivedWeightKg);
      if (!Number.isFinite(weightKgNum) || weightKgNum < 50 || weightKgNum > 200_000) {
        return res.status(400).json({ error: 'Actual received weighbridge weight (kg) must be between 50 and 200,000.' });
      }

      const updated = await db.transaction(async (tx) => {
        const rows = await tx.select().from(reservations).where(eq(reservations.id, resId)).limit(1);
        if (rows.length === 0) throw new Error('RESERVATION_NOT_FOUND');
        const current = rows[0];

        if (req.authUser!.role !== 'platform_admin' && current.factoryId !== req.authUser!.factoryId) {
          throw new Error('FORBIDDEN_ORG');
        }
        if (current.pickupStatus !== 'delivered') {
          throw new Error('NOT_YET_DELIVERED');
        }

        const [savedRes] = await tx
          .update(reservations)
          .set({
            receiptStatus: 'received',
            receivedAt: new Date(),
            receivedWeightKg: weightKgNum,
            weighbridgeFileId: weighbridgeFileId ? Number(weighbridgeFileId) : current.weighbridgeFileId,
            weighbridgeFileName: weighbridgeFileName
              ? String(weighbridgeFileName).trim().slice(0, 140)
              : current.weighbridgeFileName,
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, current.id))
          .returning();

        await appendHashedPassportEvents(tx, current.passportId, [
          {
            stage: 6,
            eventType: 'FACTORY_RECEIPT_CONFIRMED',
            actorName: req.authUser!.fullName,
            actorRole: req.authUser!.role,
            summaryEn: `Recycling facility confirmed physical weighbridge intake of ${weightKgNum.toLocaleString()} kg (${(weightKgNum / 1000).toFixed(3)} t). Status remains DELIVERED pending verified recycling outcome.`,
            summaryAr: `أكد مصنع التدوير استلام ${weightKgNum.toLocaleString()} كجم على الميزان. الحالة لا تزال "تم التسليم" بانتظار توثيق نتائج إعادة التدوير.`,
            metadataJson: JSON.stringify({
              reservationCode: current.reservationCode,
              receivedWeightKg: weightKgNum,
              weighbridgeFileId: weighbridgeFileId || null,
            }),
            evidenceFileId: weighbridgeFileId ? Number(weighbridgeFileId) : null,
          },
        ]);

        await notifyOrganization(
          { hubId: current.hubId },
          {
            type: 'delivery',
            titleEn: `Facility Weighbridge Receipt Confirmed (${current.reservationCode})`,
            titleAr: `تأكيد استلام المصنع على الميزان (${current.reservationCode})`,
            messageEn: `Received ${weightKgNum.toLocaleString()} kg. Awaiting verified recycling output to seal Stage 7 ESG.`,
            messageAr: `تم استلام ${weightKgNum.toLocaleString()} كجم بانتظار توثيق مخرجات التدوير.`,
            entityType: 'reservation',
            entityId: String(current.id),
          },
          tx
        );

        return savedRes;
      });

      return res.json({ reservation: updated });
    } catch (error: any) {
      const msg = String(error?.message || '');
      if (msg === 'RESERVATION_NOT_FOUND') return res.status(404).json({ error: 'Reservation not found.' });
      if (msg === 'FORBIDDEN_ORG') return res.status(403).json({ error: 'Forbidden: Only the receiving facility can confirm intake.' });
      if (msg === 'NOT_YET_DELIVERED') {
        return res.status(409).json({ error: 'Shipment must be marked delivered by 3PL before confirming facility receipt.' });
      }
      console.error('Confirm factory receipt error:', error);
      return res.status(500).json({ error: 'Failed to confirm physical receipt.' });
    }
  }
);

app.post(
  '/api/reservations/:id/recycle',
  requireAuth,
  requireRole('factory_procurement', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const resId = Number(req.params.id);
      const {
        recoveredTons,
        residualTons = 0,
        lossTons = 0,
        recyclingEvidenceFileId,
        recyclingEvidenceName,
        recyclingNotes,
      } = req.body || {};

      if (!Number.isInteger(resId) || resId <= 0) {
        return res.status(400).json({ error: 'Invalid reservation ID.' });
      }

      const recTons = Number(recoveredTons);
      const residTons = Number(residualTons) || 0;
      const lTons = Number(lossTons) || 0;

      if (!Number.isFinite(recTons) || recTons <= 0) {
        return res.status(400).json({ error: 'Verified recovered output tonnage must be greater than 0.' });
      }
      if (residTons < 0 || lTons < 0) {
        return res.status(400).json({ error: 'Residual and processing loss tonnages cannot be negative.' });
      }

      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM reservations WHERE id = ${resId} FOR UPDATE`);
        const rows = await tx.select().from(reservations).where(eq(reservations.id, resId)).limit(1);
        if (rows.length === 0) throw new Error('RESERVATION_NOT_FOUND');
        const current = rows[0];

        if (req.authUser!.role !== 'platform_admin' && current.factoryId !== req.authUser!.factoryId) {
          throw new Error('FORBIDDEN_ORG');
        }
        if (current.pickupStatus !== 'delivered') throw new Error('NOT_YET_DELIVERED');
        if (current.recyclingStatus === 'verified_recycled') throw new Error('ALREADY_RECYCLED');

        await tx.execute(sql`SELECT id FROM waste_passports WHERE id = ${current.passportId} FOR UPDATE`);
        const [passport] = await tx
          .select()
          .from(wastePassports)
          .where(eq(wastePassports.id, current.passportId))
          .limit(1);
        const [hub] = await tx
          .select()
          .from(wasteSourceHubs)
          .where(eq(wasteSourceHubs.id, current.hubId))
          .limit(1);
        const [factory] = await tx
          .select()
          .from(recyclingFactories)
          .where(eq(recyclingFactories.id, current.factoryId))
          .limit(1);

        const deliveredTonsBasis = current.receivedWeightKg
          ? Number((current.receivedWeightKg / 1000).toFixed(3))
          : current.handoffWeightKg
          ? Number((current.handoffWeightKg / 1000).toFixed(3))
          : current.quantityTons;

        const totalReconciled = Number((recTons + residTons + lTons).toFixed(3));
        if (totalReconciled > deliveredTonsBasis * 1.05 + 0.01) {
          throw new Error(`MASS_BALANCE_EXCEEDED:${deliveredTonsBasis}`);
        }

        const factor = await getEmissionFactorForCategory(passport.materialCategory);
        const distanceKm =
          current.transportDistanceKm > 0
            ? current.transportDistanceKm
            : Number(haversineKm(hub.lat, hub.lng, factory.lat, factory.lng).toFixed(1));

        const impact = calculateVerifiedRecyclingImpact({
          recoveredTons: recTons,
          deliveredTons: deliveredTonsBasis,
          residualTons: residTons,
          lossTons: lTons,
          transportDistanceKm: distanceKm,
          factor,
          hasWeighbridgeTicket: Boolean(current.weighbridgeFileId || current.receivedWeightKg),
          hasRecyclingEvidence: Boolean(recyclingEvidenceFileId),
        });

        const [savedRes] = await tx
          .update(reservations)
          .set({
            receiptStatus: 'received',
            receivedAt: current.receivedAt || new Date(),
            receivedWeightKg: current.receivedWeightKg || Math.round(deliveredTonsBasis * 1000),
            recyclingStatus: 'verified_recycled',
            recycledAt: new Date(),
            recoveredTons: impact.recoveredTons,
            residualTons: impact.residualTons,
            lossTons: impact.lossTons,
            recyclingEvidenceFileId: recyclingEvidenceFileId ? Number(recyclingEvidenceFileId) : null,
            recyclingEvidenceName: recyclingEvidenceName
              ? String(recyclingEvidenceName).trim().slice(0, 140)
              : null,
            recyclingNotes: recyclingNotes ? String(recyclingNotes).trim().slice(0, 1000) : null,
            transportDistanceKm: impact.transportDistanceKm,
            transportEmissionsTons: impact.transportEmissionsTons,
            co2eAvoidedTons: impact.netVerifiedCo2eTons,
            esgConfidenceLevel: impact.confidenceLevel,
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, current.id))
          .returning();

        const nextRecycledTons = Number((passport.recycledTons + impact.recoveredTons).toFixed(3));
        const nextResidualTons = Number((passport.residualTons + impact.residualTons).toFixed(3));
        const nextRejectedTons = Number((passport.rejectedTons + impact.lossTons).toFixed(3));
        const nextVerifiedCo2e = Number((passport.verifiedCo2eTons + impact.netVerifiedCo2eTons).toFixed(3));

        const [savedPassport] = await tx
          .update(wastePassports)
          .set({
            recycledTons: nextRecycledTons,
            residualTons: nextResidualTons,
            rejectedTons: nextRejectedTons,
            verifiedCo2eTons: nextVerifiedCo2e,
            emissionFactorVersion: impact.factorVersion,
            currentStage: 7,
            status: 'recycled',
            lifecycleStatus: 'RECYCLED',
            updatedAt: new Date(),
          })
          .where(eq(wastePassports.id, passport.id))
          .returning();

        await appendHashedPassportEvents(tx, passport.id, [
          {
            stage: 7,
            eventType: 'RECYCLING_VERIFIED_ESG',
            actorName: `${req.authUser!.fullName} (${factory.nameEn})`,
            actorRole: req.authUser!.role,
            summaryEn: `Verified recycling outcome sealed at ${factory.nameEn}: ${impact.recoveredTons.toFixed(2)} t recovered (${impact.recoveryYieldPct}% yield), ${impact.residualTons.toFixed(2)} t residual, ${impact.lossTons.toFixed(2)} t loss. Net GHG avoided: ${impact.netVerifiedCo2eTons.toFixed(2)} tCO2e (Gross ${impact.grossRecyclingCo2eTons.toFixed(2)} - 3PL Freight ${impact.transportEmissionsTons.toFixed(3)} tCO2e; Confidence: ${impact.confidenceLevel.toUpperCase()}).`,
            summaryAr: `تم التحقق النهائي من إعادة التدوير في ${factory.nameAr}: ${impact.recoveredTons.toFixed(2)} طن مواد مستردة (${impact.recoveryYieldPct}%). صافي الانبعاثات المتجنبة: ${impact.netVerifiedCo2eTons.toFixed(2)} طن CO2e بعد خصم انبعاثات النقل.`,
            metadataJson: JSON.stringify(impact),
            evidenceFileId: recyclingEvidenceFileId ? Number(recyclingEvidenceFileId) : null,
            lat: factory.lat,
            lng: factory.lng,
          },
        ]);

        await notifyOrganization(
          { hubId: current.hubId },
          {
            type: 'recycling',
            titleEn: `Stage 7 Recycling Verified (${passport.passportCode})`,
            titleAr: `تم توثيق إعادة التدوير — المرحلة 7 (${passport.passportCode})`,
            messageEn: `${factory.nameEn} verified ${impact.recoveredTons.toFixed(2)} t recovered output (${impact.netVerifiedCo2eTons.toFixed(2)} tCO2e net avoided).`,
            messageAr: `وثق مصنع ${factory.nameAr} استرداد ${impact.recoveredTons.toFixed(2)} طن وتجنب ${impact.netVerifiedCo2eTons.toFixed(2)} طن CO2e.`,
            entityType: 'passport',
            entityId: passport.passportCode,
          },
          tx
        );

        await dispatchNotification(
          {
            targetRole: 'platform_admin',
            type: 'recycling',
            titleEn: `Verified Recycling Outcome Sealed (${passport.passportCode})`,
            titleAr: `اعتماد نتيجة إعادة تدوير (${passport.passportCode})`,
            messageEn: `${impact.recoveredTons.toFixed(2)} t recovered / ${impact.netVerifiedCo2eTons.toFixed(2)} tCO2e net (${impact.confidenceLevel}).`,
            messageAr: `تم استرداد ${impact.recoveredTons.toFixed(2)} طن بصافي ${impact.netVerifiedCo2eTons.toFixed(2)} طن CO2e.`,
            entityType: 'passport',
            entityId: passport.passportCode,
          },
          tx
        );

        return { reservation: savedRes, passport: savedPassport, impact };
      });

      return res.json(result);
    } catch (error: any) {
      const msg = String(error?.message || '');
      if (msg === 'RESERVATION_NOT_FOUND') return res.status(404).json({ error: 'Reservation not found.' });
      if (msg === 'FORBIDDEN_ORG') {
        return res.status(403).json({ error: 'Forbidden: Only the receiving recycling facility can verify recycling.' });
      }
      if (msg === 'NOT_YET_DELIVERED') {
        return res.status(409).json({ error: 'Material must be physically delivered before recording recycling outcomes.' });
      }
      if (msg === 'ALREADY_RECYCLED') {
        return res.status(409).json({ error: 'Recycling outcome has already been verified for this shipment.' });
      }
      if (msg.startsWith('MASS_BALANCE_EXCEEDED:')) {
        const basis = msg.split(':')[1];
        return res.status(400).json({
          error: `Mass balance violation: recovered + residual + loss exceeds delivered tonnage (${basis} t + 5% weighbridge tolerance).`,
        });
      }
      console.error('Verify recycling outcome error:', error);
      return res.status(500).json({ error: 'Failed to record verified recycling outcome.' });
    }
  }
);

// ============================================================================
// 6. CERTIFIED 3PL LOGISTICS WORKSPACE — STRICT ORG SCOPING & POD (STAGE 6)
// ============================================================================

app.get(
  '/api/driver/jobs',
  requireAuth,
  requireRole('driver_3pl', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const isAdmin = req.authUser!.role === 'platform_admin';
      const providerId = req.authUser!.logisticsProviderId;

      if (!isAdmin && !providerId) {
        return res.status(403).json({ error: 'No certified 3PL provider is linked to this account.' });
      }

      const [providerRows, vehiclesRows] = await Promise.all([
        providerId
          ? db.select().from(logisticsProviders).where(eq(logisticsProviders.id, providerId)).limit(1)
          : db.select().from(logisticsProviders).limit(1),
        !isAdmin && providerId
          ? db
              .select()
              .from(logisticsVehicles)
              .where(eq(logisticsVehicles.logisticsProviderId, providerId))
              .orderBy(desc(logisticsVehicles.createdAt))
          : db.select().from(logisticsVehicles).orderBy(desc(logisticsVehicles.createdAt)),
      ]);

      const baseQuery = db
        .select({
          reservation: reservations,
          passport: wastePassports,
          hub: wasteSourceHubs,
          factory: recyclingFactories,
          provider: logisticsProviders,
        })
        .from(reservations)
        .innerJoin(wastePassports, eq(reservations.passportId, wastePassports.id))
        .innerJoin(wasteSourceHubs, eq(reservations.hubId, wasteSourceHubs.id))
        .innerJoin(recyclingFactories, eq(reservations.factoryId, recyclingFactories.id))
        .innerJoin(logisticsProviders, eq(reservations.logisticsProviderId, logisticsProviders.id))
        .orderBy(desc(reservations.createdAt));

      // Strict org isolation: 3PL drivers ONLY see jobs assigned to their certified 3PL company
      const rows = !isAdmin && providerId
        ? await baseQuery.where(eq(reservations.logisticsProviderId, providerId))
        : await baseQuery;

      const vehicleMap = new Map(vehiclesRows.map((v) => [v.id, v]));

      const jobs = rows.map((r) => ({
        ...r.reservation,
        passportCode: r.passport.passportCode,
        materialCategory: r.passport.materialCategory,
        materialSubtype: r.passport.materialSubtype,
        purityGrade: r.passport.purityGrade,
        lifecycleStatus: r.passport.lifecycleStatus,
        co2eFactorPerTon: r.passport.co2eFactorPerTon,
        vehicle: r.reservation.vehicleId ? vehicleMap.get(r.reservation.vehicleId) || null : null,
        hub: {
          id: r.hub.id,
          code: r.hub.code,
          nameEn: r.hub.nameEn,
          nameAr: r.hub.nameAr,
          governorate: r.hub.governorate,
          address: r.hub.address,
          lat: r.hub.lat,
          lng: r.hub.lng,
        },
        factory: {
          id: r.factory.id,
          nameEn: r.factory.nameEn,
          nameAr: r.factory.nameAr,
          industrialZone: r.factory.industrialZone,
          governorate: r.factory.governorate,
          lat: r.factory.lat,
          lng: r.factory.lng,
        },
        provider: {
          id: r.provider.id,
          nameEn: r.provider.nameEn,
          nameAr: r.provider.nameAr,
          envTransportLicenseId: r.provider.envTransportLicenseId,
          onTimeRate: r.provider.onTimeRate,
        },
      }));

      return res.json({
        provider: providerRows[0] || null,
        vehicles: vehiclesRows,
        jobs,
      });
    } catch (error) {
      console.error('Driver jobs error:', error);
      return res.status(500).json({ error: 'Failed to load 3PL driver route manifest.' });
    }
  }
);

app.patch(
  '/api/reservations/:id/status',
  requireAuth,
  requireRole('driver_3pl', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const resId = Number(req.params.id);
      const {
        nextStatus,
        vehicleId,
        handoffWeightKg,
        handoffVerificationMethod,
        qrPassportCode,
        podFileId,
        podFileName,
        gpsLat,
        gpsLng,
      } = req.body || {};

      if (!Number.isInteger(resId) || resId <= 0) {
        return res.status(400).json({ error: 'Invalid reservation ID.' });
      }
      if (!PICKUP_STATUS_FLOW.includes(nextStatus)) {
        return res.status(400).json({ error: 'Invalid pickup status.' });
      }

      const updated = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM reservations WHERE id = ${resId} FOR UPDATE`);
        const resRows = await tx.select().from(reservations).where(eq(reservations.id, resId)).limit(1);
        if (resRows.length === 0) throw new Error('RESERVATION_NOT_FOUND');
        const current = resRows[0];

        // Strict 3PL organization isolation
        if (
          req.authUser!.role !== 'platform_admin' &&
          current.logisticsProviderId !== req.authUser!.logisticsProviderId
        ) {
          throw new Error('FORBIDDEN_ORG');
        }
        if (current.pickupStatus === 'cancelled') {
          throw new Error('SHIPMENT_CANCELLED');
        }

        const [passport] = await tx
          .select()
          .from(wastePassports)
          .where(eq(wastePassports.id, current.passportId))
          .limit(1);
        const [hub] = await tx
          .select()
          .from(wasteSourceHubs)
          .where(eq(wasteSourceHubs.id, current.hubId))
          .limit(1);
        const [factory] = await tx
          .select()
          .from(recyclingFactories)
          .where(eq(recyclingFactories.id, current.factoryId))
          .limit(1);
        const [provider] = await tx
          .select()
          .from(logisticsProviders)
          .where(eq(logisticsProviders.id, current.logisticsProviderId))
          .limit(1);

        const curIdx = PICKUP_STATUS_FLOW.indexOf(current.pickupStatus as PickupStatus);
        const nextIdx = PICKUP_STATUS_FLOW.indexOf(nextStatus as PickupStatus);
        if (nextIdx <= curIdx) {
          throw new Error('INVALID_TRANSITION');
        }

        const latVal = Number.isFinite(Number(gpsLat)) ? Number(gpsLat) : hub.lat;
        const lngVal = Number.isFinite(Number(gpsLng)) ? Number(gpsLng) : hub.lng;

        const updatePayload: Partial<typeof reservations.$inferInsert> = {
          pickupStatus: nextStatus,
          updatedAt: new Date(),
        };

        if (vehicleId && Number.isInteger(Number(vehicleId))) {
          updatePayload.vehicleId = Number(vehicleId);
        }

        if (nextStatus === 'accepted') {
          updatePayload.acceptedBy3plAt = new Date();
          await appendHashedPassportEvents(tx, passport.id, [
            {
              stage: Math.max(passport.currentStage, 5),
              eventType: 'DISPATCH_ACCEPTED_3PL',
              actorName: req.authUser!.fullName,
              actorRole: req.authUser!.role,
              summaryEn: `External 3PL ${provider.nameEn} (${provider.envTransportLicenseId}) accepted pickup dispatch ${current.reservationCode}.`,
              summaryAr: `قبلت شركة النقل المعتمدة ${provider.nameAr} طلب الاستلام ${current.reservationCode}.`,
              lat: latVal,
              lng: lngVal,
            },
          ]);
        }

        if (nextStatus === 'en_route' || nextStatus === 'arrived') {
          await tx
            .update(wastePassports)
            .set({
              currentStage: Math.max(passport.currentStage, 6),
              status: 'in_transit',
              updatedAt: new Date(),
            })
            .where(eq(wastePassports.id, passport.id));

          await appendHashedPassportEvents(tx, passport.id, [
            {
              stage: 6,
              eventType: nextStatus === 'en_route' ? 'DRIVER_EN_ROUTE' : 'DRIVER_ARRIVED',
              actorName: req.authUser!.fullName,
              actorRole: req.authUser!.role,
              summaryEn:
                nextStatus === 'en_route'
                  ? `3PL vehicle (${provider.nameEn}, License ${provider.envTransportLicenseId}) departed en route to ${hub.nameEn}.`
                  : `3PL driver arrived on-site at ${hub.nameEn} for Passport ${passport.passportCode} pickup.`,
              summaryAr:
                nextStatus === 'en_route'
                  ? `انطلقت شاحنة ${provider.nameAr} في الطريق إلى ${hub.nameAr}.`
                  : `وصل السائق إلى موقع ${hub.nameAr} لاستلام الدفعة ${passport.passportCode}.`,
              lat: latVal,
              lng: lngVal,
            },
          ]);
        }

        if (nextStatus === 'picked_up') {
          if (qrPassportCode) {
            const rawQr = String(qrPassportCode).trim();
            const matched = rawQr.match(/OURO-PAS-\d{4}-[A-Z0-9]{4,10}/i);
            const normalizedQr = (matched ? matched[0] : rawQr).toUpperCase();
            if (normalizedQr !== passport.passportCode.toUpperCase()) {
              throw new Error('QR_MISMATCH');
            }
          }
          const verifiedWeightKg =
            Number(handoffWeightKg) > 0 ? Number(handoffWeightKg) : Math.round(current.quantityTons * 1000);
          const expectedKg = Math.round(current.quantityTons * 1000);
          const deltaPct = Number((((verifiedWeightKg - expectedKg) / expectedKg) * 100).toFixed(2));
          const method = handoffVerificationMethod === 'ble_scale' ? 'ble_scale' : 'manifest_confirmed';
          const collectedTonsNow = Number((verifiedWeightKg / 1000).toFixed(3));

          updatePayload.handoffWeightKg = verifiedWeightKg;
          updatePayload.handoffVerificationMethod = method;
          updatePayload.handoffQrVerified = true;
          updatePayload.handoffGpsLat = latVal;
          updatePayload.handoffGpsLng = lngVal;
          updatePayload.handoffVerifiedAt = new Date();

          await tx
            .update(wasteSourceHubs)
            .set({
              reservedTons: Math.max(0, Number((hub.reservedTons - current.quantityTons).toFixed(3))),
              lastPickupAt: new Date(),
            })
            .where(eq(wasteSourceHubs.id, hub.id));

          await tx
            .update(wastePassports)
            .set({
              reservedTons: Math.max(0, Number((passport.reservedTons - current.quantityTons).toFixed(3))),
              collectedTons: Number((passport.collectedTons + collectedTonsNow).toFixed(3)),
              currentStage: Math.max(passport.currentStage, 6),
              status: 'in_transit',
              updatedAt: new Date(),
            })
            .where(eq(wastePassports.id, passport.id));

          await appendHashedPassportEvents(tx, passport.id, [
            {
              stage: 6,
              eventType: 'PICKUP_HANDOFF_VERIFIED',
              actorName: req.authUser!.fullName,
              actorRole: req.authUser!.role,
              summaryEn: `Passport QR verified on-site. Handoff weight logged at ${verifiedWeightKg.toLocaleString()} kg (Delta: ${deltaPct >= 0 ? '+' : ''}${deltaPct}%) via ${method === 'ble_scale' ? 'BLE Scale' : 'Confirmed Manifest'}.`,
              summaryAr: `تم مسح رمز QR وتوثيق وزن الاستلام ${verifiedWeightKg.toLocaleString()} كجم (الفرق ${deltaPct}%).`,
              metadataJson: JSON.stringify({ verifiedWeightKg, expectedKg, deltaPct, method }),
              lat: latVal,
              lng: lngVal,
            },
          ]);
        }

        if (nextStatus === 'delivered') {
          // STRICT PRODUCT RULE: Delivery completes Stage 6 (DELIVERED), NEVER Stage 7 (RECYCLED)!
          // Verified CO2e remains 0 until the Recycling Facility records verified recycling outcomes.
          if (!current.handoffVerifiedAt) {
            await tx
              .update(wasteSourceHubs)
              .set({
                reservedTons: Math.max(0, Number((hub.reservedTons - current.quantityTons).toFixed(3))),
                lastPickupAt: new Date(),
              })
              .where(eq(wasteSourceHubs.id, hub.id));
          }

          const finalDeliveredTons = current.handoffWeightKg
            ? Number((current.handoffWeightKg / 1000).toFixed(3))
            : current.quantityTons;

          updatePayload.deliveredAt = new Date();
          if (podFileId) updatePayload.podFileId = Number(podFileId);
          if (podFileName) updatePayload.podFileName = String(podFileName).trim().slice(0, 140);
          // Do NOT claim verified CO2e at delivery!
          updatePayload.co2eAvoidedTons = 0;

          const newTotalDelivered = Number((passport.deliveredTons + finalDeliveredTons).toFixed(3));
          const nextLifecycle = passport.lifecycleStatus === 'RECYCLED' ? 'RECYCLED' : 'DELIVERED';
          const nextStage = passport.lifecycleStatus === 'RECYCLED' ? 7 : 6;

          await tx
            .update(wastePassports)
            .set({
              reservedTons: current.handoffVerifiedAt
                ? passport.reservedTons
                : Math.max(0, Number((passport.reservedTons - current.quantityTons).toFixed(3))),
              collectedTons: current.handoffVerifiedAt
                ? passport.collectedTons
                : Number((passport.collectedTons + finalDeliveredTons).toFixed(3)),
              deliveredTons: newTotalDelivered,
              currentStage: nextStage,
              status: nextLifecycle === 'RECYCLED' ? 'recycled' : 'delivered',
              lifecycleStatus: nextLifecycle,
              updatedAt: new Date(),
            })
            .where(eq(wastePassports.id, passport.id));

          await appendHashedPassportEvents(tx, passport.id, [
            {
              stage: 6,
              eventType: 'DELIVERY_CONFIRMED_PENDING_RECYCLING',
              actorName: `${req.authUser!.fullName} -> ${factory.nameEn}`,
              actorRole: req.authUser!.role,
              summaryEn: `3PL delivered ${finalDeliveredTons.toFixed(2)} t to ${factory.nameEn} (${factory.industrialZone}). Status: DELIVERED — awaiting facility intake confirmation and verified recycling outcome for Stage 7 ESG.`,
              summaryAr: `تم التسليم في ${factory.nameAr} (${finalDeliveredTons.toFixed(2)} طن). الحالة: تم التسليم — بانتظار تأكيد المصنع وتوثيق نتائج إعادة التدوير للمرحلة 7.`,
              metadataJson: JSON.stringify({
                deliveredTons: finalDeliveredTons,
                factoryId: factory.id,
                podFileId: podFileId || null,
                lifecycleStatus: 'DELIVERED',
              }),
              evidenceFileId: podFileId ? Number(podFileId) : null,
              lat: factory.lat,
              lng: factory.lng,
            },
          ]);

          await notifyOrganization(
            { factoryId: factory.id },
            {
              type: 'delivery',
              titleEn: `Shipment Delivered — Action Required (${current.reservationCode})`,
              titleAr: `تم تسليم الشحنة — مطلوب التأكيد (${current.reservationCode})`,
              messageEn: `${finalDeliveredTons.toFixed(2)} t delivered by ${provider.nameEn}. Confirm weighbridge receipt and record verified recycling outcome.`,
              messageAr: `تم تسليم ${finalDeliveredTons.toFixed(2)} طن. يرجى تأكيد وزن الميزان وتوثيق مخرجات إعادة التدوير.`,
              entityType: 'reservation',
              entityId: String(current.id),
            },
            tx
          );
        }

        const [savedRes] = await tx
          .update(reservations)
          .set(updatePayload)
          .where(eq(reservations.id, current.id))
          .returning();

        return savedRes;
      });

      return res.json({ reservation: updated });
    } catch (error: any) {
      const msg = String(error?.message || '');
      if (msg === 'RESERVATION_NOT_FOUND') return res.status(404).json({ error: 'Pickup job not found.' });
      if (msg === 'FORBIDDEN_ORG') {
        return res.status(403).json({ error: 'Forbidden: This shipment is assigned to a different 3PL provider.' });
      }
      if (msg === 'SHIPMENT_CANCELLED') {
        return res.status(409).json({ error: 'Cancelled shipments cannot be progressed.' });
      }
      if (msg === 'INVALID_TRANSITION') {
        return res.status(400).json({ error: 'Pickup status cannot move backwards or repeat.' });
      }
      if (msg === 'QR_MISMATCH') {
        return res.status(400).json({
          error: 'Scanned Passport QR code does not match this assigned lot. Please verify the physical label.',
        });
      }
      console.error('Driver status transition error:', error);
      return res.status(500).json({ error: 'Failed to update pickup status.' });
    }
  }
);

// ============================================================================
// 7. ADMIN COMMAND DASHBOARD, KYC GOVERNANCE & HUB MANAGEMENT
// ============================================================================

app.get('/api/admin/overview', requireAuth, requireRole('platform_admin'), async (_req: AuthRequest, res) => {
  try {
    const [
      hubs,
      factories,
      providers,
      vehicles,
      passports,
      allReservations,
      recentEvents,
      auditLogs,
      allUsers,
      allFactors,
      allDisputes,
    ] = await Promise.all([
      db.select().from(wasteSourceHubs).orderBy(asc(wasteSourceHubs.id)),
      db.select().from(recyclingFactories).orderBy(desc(recyclingFactories.createdAt)),
      db.select().from(logisticsProviders).orderBy(desc(logisticsProviders.onTimeRate)),
      db.select().from(logisticsVehicles).orderBy(desc(logisticsVehicles.createdAt)),
      db.select().from(wastePassports).orderBy(desc(wastePassports.createdAt)),
      db.select().from(reservations).orderBy(desc(reservations.createdAt)),
      db
        .select({
          event: passportEvents,
          passportCode: wastePassports.passportCode,
          materialCategory: wastePassports.materialCategory,
        })
        .from(passportEvents)
        .innerJoin(wastePassports, eq(passportEvents.passportId, wastePassports.id))
        .orderBy(desc(passportEvents.createdAt))
        .limit(25),
      db.select().from(adminAuditLogs).orderBy(desc(adminAuditLogs.createdAt)).limit(30),
      db
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          phone: users.phone,
          accountCode: users.accountCode,
          role: users.role,
          isActive: users.isActive,
          hubId: users.hubId,
          factoryId: users.factoryId,
          logisticsProviderId: users.logisticsProviderId,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(asc(users.id)),
      db.select().from(emissionFactors).orderBy(asc(emissionFactors.materialCategory)),
      db.select().from(disputes).orderBy(desc(disputes.createdAt)).limit(40),
    ]);

    const nonCancelled = passports.filter((p) => p.status !== 'cancelled');
    const listedTons = Number(
      nonCancelled.reduce((sum, p) => sum + p.initialWeightKg / 1000, 0).toFixed(2)
    );
    const deliveredTons = Number(
      nonCancelled.reduce((sum, p) => sum + p.deliveredTons, 0).toFixed(2)
    );
    const verifiedRecycledTons = Number(
      nonCancelled.reduce((sum, p) => sum + p.recycledTons, 0).toFixed(2)
    );
    const verifiedCo2eTons = Number(
      nonCancelled.reduce((sum, p) => sum + p.verifiedCo2eTons, 0).toFixed(2)
    );
    const estimatedCo2eTons = Number(
      nonCancelled
        .filter((p) => p.lifecycleStatus !== 'RECYCLED')
        .reduce((sum, p) => sum + (p.initialWeightKg / 1000) * p.co2eFactorPerTon, 0)
        .toFixed(2)
    );

    const catTotals: Record<
      string,
      {
        category: string;
        label: string;
        tons: number;
        deliveredTons: number;
        recycledTons: number;
        verifiedCo2e: number;
        co2e: number;
        valueEgp: number;
      }
    > = {};
    for (const [key, meta] of Object.entries(MATERIAL_METADATA)) {
      catTotals[key] = {
        category: key,
        label: meta.en,
        tons: 0,
        deliveredTons: 0,
        recycledTons: 0,
        verifiedCo2e: 0,
        co2e: 0,
        valueEgp: 0,
      };
    }
    for (const p of nonCancelled) {
      const tons = p.initialWeightKg / 1000;
      if (catTotals[p.materialCategory]) {
        catTotals[p.materialCategory].tons = Number((catTotals[p.materialCategory].tons + tons).toFixed(2));
        catTotals[p.materialCategory].deliveredTons = Number(
          (catTotals[p.materialCategory].deliveredTons + p.deliveredTons).toFixed(2)
        );
        catTotals[p.materialCategory].recycledTons = Number(
          (catTotals[p.materialCategory].recycledTons + p.recycledTons).toFixed(2)
        );
        catTotals[p.materialCategory].verifiedCo2e = Number(
          (catTotals[p.materialCategory].verifiedCo2e + p.verifiedCo2eTons).toFixed(2)
        );
        catTotals[p.materialCategory].co2e = catTotals[p.materialCategory].verifiedCo2e;
        catTotals[p.materialCategory].valueEgp = Math.round(
          catTotals[p.materialCategory].valueEgp + tons * p.pricePerTonEgp
        );
      }
    }
    const categoryFlow = Object.values(catTotals).sort((a, b) => b.tons - a.tons);
    const leadingCategory = categoryFlow[0]?.label || 'Paper & Cardboard';

    // Real DB-grouped lifecycle breakdown (no synthetic fabricated historical growth curves)
    const lifecycleBreakdownChart = categoryFlow.map((c) => ({
      name: c.label.split(' ')[0],
      fullLabel: c.label,
      listedTons: c.tons,
      deliveredTons: c.deliveredTons,
      recycledTons: c.recycledTons,
    }));

    const hubsWithCapacity = hubs.map((h) => {
      const occupiedTons = Number((h.availableTons + h.reservedTons).toFixed(2));
      const occupancyPct = h.maxCapacityTons > 0 ? Math.round((occupiedTons / h.maxCapacityTons) * 100) : 0;
      return {
        ...h,
        occupiedTons,
        occupancyPct,
        isHighCapacity: occupancyPct >= 80,
      };
    });

    const hubPurityChart = hubsWithCapacity.map((h) => ({
      name: h.code,
      fullName: h.nameEn,
      purityScore: h.purityScore,
      occupancyPct: h.occupancyPct,
    }));

    const providerPerformanceChart = providers.map((pr) => ({
      name: pr.nameEn.split(' ').slice(0, 2).join(' '),
      fullName: pr.nameEn,
      onTimeRate: pr.onTimeRate,
      fleetCount: pr.fleetCount,
      licenseId: pr.envTransportLicenseId,
    }));

    const generatorsByType: Record<string, number> = {
      factory: 0,
      company: 0,
      educational_institution: 0,
      service_institution: 0,
      hotel: 0,
      commercial: 0,
    };
    for (const h of hubs) {
      if (generatorsByType[h.hubType] !== undefined) {
        generatorsByType[h.hubType] += 1;
      }
    }

    const samplePassportsCount = nonCancelled.filter((p) => p.isSampleData).length;
    const livePassportsCount = nonCancelled.length - samplePassportsCount;

    return res.json({
      kpis: {
        listedTons,
        totalCollectedTons: listedTons,
        deliveredTons,
        verifiedRecycledTons,
        leadingCategory,
        activeSourceHubs: hubs.filter((h) => h.isActive).length,
        generatorsByType,
        approvedFactories: factories.filter((f) => f.kycStatus === 'approved').length,
        pendingFactories: factories.filter((f) => f.kycStatus === 'pending').length,
        certified3plPartners: providers.filter((p) => p.isVerified).length,
        verifiedCo2eTons,
        estimatedCo2eTons,
        highCapacityAlerts: hubsWithCapacity.filter((h) => h.isHighCapacity).length,
        openDisputesCount: allDisputes.filter((d) => d.status === 'open' || d.status === 'investigating').length,
      },
      dataIntegrityNotice: {
        hasSamplePilotRecords: samplePassportsCount > 0,
        samplePassportsCount,
        livePassportsCount,
      },
      emailProviderStatus: getEmailProviderStatus(),
      charts: {
        lifecycleBreakdownChart,
        categoryFlow,
        hubPurityChart,
        providerPerformanceChart,
      },
      hubs: hubsWithCapacity,
      factories,
      providers,
      vehicles,
      users: allUsers,
      emissionFactors: allFactors,
      disputes: allDisputes,
      passports,
      reservationsCount: allReservations.length,
      recentEvents: recentEvents.map((e) => ({
        ...e.event,
        passportCode: e.passportCode,
        materialCategory: e.materialCategory,
      })),
      auditLogs,
    });
  } catch (error) {
    console.error('Admin overview error:', error);
    return res.status(500).json({ error: 'Failed to load Admin command overview.' });
  }
});

app.patch(
  '/api/admin/factories/:id/kyc',
  requireAuth,
  requireRole('platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const factoryId = Number(req.params.id);
      const { decision, reason } = req.body || {};

      if (!Number.isInteger(factoryId) || factoryId <= 0) {
        return res.status(400).json({ error: 'Invalid factory ID.' });
      }
      if (decision !== 'approved' && decision !== 'rejected') {
        return res.status(400).json({ error: 'Decision must be "approved" or "rejected".' });
      }
      if (typeof reason !== 'string' || reason.trim().length < 5) {
        return res.status(400).json({
          error: 'A mandatory audit review note (minimum 5 characters) is required for KYC governance.',
        });
      }

      const updated = await db.transaction(async (tx) => {
        const [fac] = await tx
          .update(recyclingFactories)
          .set({
            kycStatus: decision,
            kycReviewNote: reason.trim(),
            kycReviewedByUid: req.authUser!.uid,
            kycReviewedAt: new Date(),
          })
          .where(eq(recyclingFactories.id, factoryId))
          .returning();

        if (!fac) throw new Error('FACTORY_NOT_FOUND');

        await tx.insert(adminAuditLogs).values({
          action: decision === 'approved' ? 'FACTORY_KYC_APPROVED' : 'FACTORY_KYC_REJECTED',
          targetType: 'recycling_factory',
          targetId: String(factoryId),
          actorEmail: req.authUser!.email,
          reason: `${fac.nameEn}: ${reason.trim()}`,
        });

        await notifyOrganization(
          { factoryId: fac.id },
          {
            type: 'kyc',
            titleEn: `KYC Verification ${decision === 'approved' ? 'Approved' : 'Rejected'}`,
            titleAr: `قرار اعتماد المصنع: ${decision === 'approved' ? 'معتمد' : 'مرفوض'}`,
            messageEn: reason.trim(),
            messageAr: reason.trim(),
            entityType: 'recycling_factory',
            entityId: String(fac.id),
          },
          tx
        );

        return fac;
      });

      return res.json({ factory: updated });
    } catch (error: any) {
      if (error?.message === 'FACTORY_NOT_FOUND') {
        return res.status(404).json({ error: 'Factory not found.' });
      }
      console.error('KYC review error:', error);
      return res.status(500).json({ error: 'Failed to update factory KYC status.' });
    }
  }
);

app.post('/api/admin/hubs', requireAuth, requireRole('platform_admin'), async (req: AuthRequest, res) => {
  try {
    const {
      nameEn,
      nameAr,
      hubType,
      commercialRegNo,
      contactPhone,
      governorate,
      address,
      lat,
      lng,
      maxCapacityTons,
    } = req.body || {};
    const validTypes: HubType[] = [
      'factory',
      'company',
      'educational_institution',
      'service_institution',
      'hotel',
      'commercial',
    ];
    if (!nameEn || !validTypes.includes(hubType) || !governorate || !address) {
      return res
        .status(400)
        .json({ error: 'Facility name, B2B facility type, governorate, and address are required.' });
    }
    const latNum = Number(lat);
    const lngNum = Number(lng);
    const capNum = Number(maxCapacityTons) || 25;
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return res.status(400).json({ error: 'Valid GPS latitude and longitude are required.' });
    }

    const prefix = governorate.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
    const code = `GEN-${prefix}-${Math.floor(100 + Math.random() * 899)}`;

    const [created] = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(wasteSourceHubs)
        .values({
          code,
          nameEn: String(nameEn).trim(),
          nameAr: String(nameAr || nameEn).trim(),
          hubType,
          commercialRegNo: commercialRegNo ? String(commercialRegNo).trim() : null,
          contactPhone: contactPhone ? String(contactPhone).trim() : null,
          governorate: String(governorate).trim(),
          address: String(address).trim(),
          lat: latNum,
          lng: lngNum,
          maxCapacityTons: capNum,
          availableTons: 0,
          reservedTons: 0,
          purityScore: 95.0,
        })
        .returning();

      await tx.insert(adminAuditLogs).values({
        action: 'GENERATOR_REGISTERED',
        targetType: 'waste_generator',
        targetId: String(inserted[0].id),
        actorEmail: req.authUser!.email,
        reason: `Registered B2B Waste Generator ${inserted[0].nameEn} (${code}, ${governorate}, ${capNum}t capacity).`,
      });

      return inserted;
    });

    return res.status(201).json({ hub: created });
  } catch (error) {
    console.error('Create generator error:', error);
    return res.status(500).json({ error: 'Failed to register new Waste Generator facility.' });
  }
});

app.post(
  '/api/admin/hubs/:id/assign-pickup',
  requireAuth,
  requireRole('platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const hubId = Number(req.params.id);
      const { logisticsProviderId } = req.body || {};

      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM waste_source_hubs WHERE id = ${hubId} FOR UPDATE`);
        const [hub] = await tx
          .select()
          .from(wasteSourceHubs)
          .where(eq(wasteSourceHubs.id, hubId))
          .limit(1);
        if (!hub) throw new Error('HUB_NOT_FOUND');

        const hubPassports = await tx
          .select()
          .from(wastePassports)
          .where(
            and(
              eq(wastePassports.hubId, hub.id),
              gte(wastePassports.availableTons, 1),
              ne(wastePassports.status, 'cancelled')
            )
          )
          .orderBy(desc(wastePassports.availableTons))
          .limit(1);

        const [provider] = logisticsProviderId
          ? await tx
              .select()
              .from(logisticsProviders)
              .where(eq(logisticsProviders.id, Number(logisticsProviderId)))
              .limit(1)
          : await tx
              .select()
              .from(logisticsProviders)
              .where(eq(logisticsProviders.isVerified, true))
              .limit(1);

        const [approvedFactory] = await tx
          .select()
          .from(recyclingFactories)
          .where(eq(recyclingFactories.kycStatus, 'approved'))
          .limit(1);

        if (!provider || !approvedFactory) {
          throw new Error('MISSING_PARTNER');
        }

        const [driver] = await tx
          .select()
          .from(users)
          .where(and(eq(users.role, 'driver_3pl'), eq(users.logisticsProviderId, provider.id)))
          .limit(1);

        let createdReservation = null;
        if (hubPassports.length > 0) {
          const lot = hubPassports[0];
          await tx.execute(sql`SELECT id FROM waste_passports WHERE id = ${lot.id} FOR UPDATE`);
          const qty = Number(Math.min(lot.availableTons, Math.max(2, lot.availableTons * 0.5)).toFixed(2));
          const totalEgp = Number((qty * lot.pricePerTonEgp).toFixed(2));
          const resCode = generateReservationCode();
          const distKm = Number(haversineKm(hub.lat, hub.lng, approvedFactory.lat, approvedFactory.lng).toFixed(1));
          const liveFactor = await getEmissionFactorForCategory(lot.materialCategory);
          const estTransport = Number(((qty * distKm * liveFactor.transportFactorKgPerTonKm) / 1000).toFixed(3));

          await tx
            .update(wastePassports)
            .set({
              availableTons: Math.max(0, Number((lot.availableTons - qty).toFixed(3))),
              reservedTons: Number((lot.reservedTons + qty).toFixed(3)),
              currentStage: Math.max(lot.currentStage, 5),
              status: 'reserved',
              updatedAt: new Date(),
            })
            .where(eq(wastePassports.id, lot.id));

          await tx
            .update(wasteSourceHubs)
            .set({
              availableTons: Math.max(0, Number((hub.availableTons - qty).toFixed(3))),
              reservedTons: Number((hub.reservedTons + qty).toFixed(3)),
            })
            .where(eq(wasteSourceHubs.id, hub.id));

          const [resRow] = await tx
            .insert(reservations)
            .values({
              reservationCode: resCode,
              passportId: lot.id,
              hubId: hub.id,
              factoryId: approvedFactory.id,
              logisticsProviderId: provider.id,
              driverUserId: driver?.id ?? null,
              quantityTons: qty,
              pricePerTonEgp: lot.pricePerTonEgp,
              totalEgp,
              pickupWindow: 'Priority Dispatch — Within 4 Hours',
              pickupStatus: 'scheduled',
              receiptStatus: 'pending',
              recyclingStatus: 'pending_recycling',
              transportDistanceKm: distKm,
              transportEmissionsTons: estTransport,
              estimatedCo2eTons: Number(Math.max(0, qty * liveFactor.co2eFactorPerTon - estTransport).toFixed(3)),
              co2eAvoidedTons: 0,
              esgConfidenceLevel: 'estimated',
              expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
            })
            .returning();

          createdReservation = resRow;

          await appendHashedPassportEvents(tx, lot.id, [
            {
              stage: 5,
              eventType: 'ADMIN_PRIORITY_3PL_DISPATCH',
              actorName: req.authUser!.fullName,
              actorRole: 'platform_admin',
              summaryEn: `Admin dispatched priority external 3PL clearance (${provider.nameEn}, ${provider.envTransportLicenseId}) for ${qty.toFixed(2)} t to relieve facility capacity.`,
              summaryAr: `تم توجيه نقل عاجل بواسطة ${provider.nameAr} لتخفيف سعة المنشأة (${qty.toFixed(2)} طن).`,
            },
          ]);
        }

        await tx.insert(adminAuditLogs).values({
          action: 'HUB_3PL_DISPATCH_ASSIGNED',
          targetType: 'waste_source_hub',
          targetId: String(hub.id),
          actorEmail: req.authUser!.email,
          reason: `Assigned ${provider.nameEn} (${provider.envTransportLicenseId}) to ${hub.nameEn}.`,
        });

        return { hub, provider, reservation: createdReservation };
      });

      return res.status(201).json(result);
    } catch (error: any) {
      if (error?.message === 'HUB_NOT_FOUND') return res.status(404).json({ error: 'Facility not found.' });
      console.error('Assign 3PL error:', error);
      return res.status(500).json({ error: 'Failed to assign 3PL pickup.' });
    }
  }
);

// ============================================================================
// 8. SCIENTIFICALLY DEFENSIBLE ESG LEDGER & HARDENED CSV EXPORTER
// ============================================================================

app.get(
  '/api/esg/report',
  requireAuth,
  requireRole('platform_admin', 'factory_procurement', 'generator_ops'),
  async (req: AuthRequest, res) => {
    try {
      const scopeCondition =
        req.authUser!.role === 'factory_procurement' && req.authUser!.factoryId
          ? and(
              eq(reservations.pickupStatus, 'delivered'),
              eq(reservations.factoryId, req.authUser!.factoryId)
            )
          : req.authUser!.role === 'generator_ops' && req.authUser!.hubId
          ? and(
              eq(reservations.pickupStatus, 'delivered'),
              eq(reservations.hubId, req.authUser!.hubId)
            )
          : eq(reservations.pickupStatus, 'delivered');

      const [rows, factorMap] = await Promise.all([
        db
          .select({
            reservation: reservations,
            passport: wastePassports,
            hub: wasteSourceHubs,
            factory: recyclingFactories,
            provider: logisticsProviders,
          })
          .from(reservations)
          .innerJoin(wastePassports, eq(reservations.passportId, wastePassports.id))
          .innerJoin(wasteSourceHubs, eq(reservations.hubId, wasteSourceHubs.id))
          .innerJoin(recyclingFactories, eq(reservations.factoryId, recyclingFactories.id))
          .innerJoin(logisticsProviders, eq(reservations.logisticsProviderId, logisticsProviders.id))
          .where(scopeCondition)
          .orderBy(desc(reservations.deliveredAt)),
        getEmissionFactorMap(),
      ]);

      const verifiedRecycledItems: any[] = [];
      const deliveredPendingRecyclingItems: any[] = [];

      for (const r of rows) {
        const factor = factorMap[r.passport.materialCategory];
        const deliveredTons = r.reservation.receivedWeightKg
          ? Number((r.reservation.receivedWeightKg / 1000).toFixed(3))
          : r.reservation.handoffWeightKg
          ? Number((r.reservation.handoffWeightKg / 1000).toFixed(3))
          : r.reservation.quantityTons;

        const baseItem = {
          passportCode: r.passport.passportCode,
          reservationCode: r.reservation.reservationCode,
          hubCode: r.hub.code,
          hubNameEn: r.hub.nameEn,
          hubGovernorate: r.hub.governorate,
          factoryNameEn: r.factory.nameEn,
          factoryTaxId: r.factory.taxId,
          logisticsProviderNameEn: r.provider.nameEn,
          logisticsLicenseId: r.provider.envTransportLicenseId,
          materialCategory: r.passport.materialCategory,
          materialLabel: factor?.labelEn || r.passport.materialCategory,
          materialSubtype: r.passport.materialSubtype,
          purityGrade: r.passport.purityGrade,
          deliveredTons,
          recoveredTons: r.reservation.recoveredTons,
          residualTons: r.reservation.residualTons,
          lossTons: r.reservation.lossTons,
          verifiedTons: r.reservation.recoveredTons, // Strictly verified recovered output!
          transportDistanceKm: r.reservation.transportDistanceKm,
          transportEmissionsTons: r.reservation.transportEmissionsTons,
          co2eFactorPerTon: factor?.co2eFactorPerTon ?? r.passport.co2eFactorPerTon,
          methodologyRef: factor?.version || r.passport.emissionFactorVersion,
          co2eAvoidedTons: r.reservation.co2eAvoidedTons,
          estimatedCo2eTons: r.reservation.estimatedCo2eTons,
          esgConfidenceLevel: r.reservation.esgConfidenceLevel,
          recyclingStatus: r.reservation.recyclingStatus,
          deliveredAt: r.reservation.deliveredAt,
          recycledAt: r.reservation.recycledAt,
          isSampleData: r.passport.isSampleData,
        };

        if (r.reservation.recyclingStatus === 'verified_recycled') {
          verifiedRecycledItems.push(baseItem);
        } else {
          deliveredPendingRecyclingItems.push(baseItem);
        }
      }

      const totalVerifiedRecycledTons = Number(
        verifiedRecycledItems.reduce((s, i) => s + i.recoveredTons, 0).toFixed(2)
      );
      const totalDeliveredPendingTons = Number(
        deliveredPendingRecyclingItems.reduce((s, i) => s + i.deliveredTons, 0).toFixed(2)
      );
      const totalTransportEmissionsTons = Number(
        verifiedRecycledItems.reduce((s, i) => s + i.transportEmissionsTons, 0).toFixed(3)
      );
      const totalResidualAndLossTons = Number(
        verifiedRecycledItems.reduce((s, i) => s + i.residualTons + i.lossTons, 0).toFixed(2)
      );
      const totalCo2eAvoidedTons = Number(
        verifiedRecycledItems.reduce((s, i) => s + i.co2eAvoidedTons, 0).toFixed(2)
      );
      const estimatedPendingCo2eTons = Number(
        deliveredPendingRecyclingItems.reduce((s, i) => s + i.estimatedCo2eTons, 0).toFixed(2)
      );

      return res.json({
        generatedAt: new Date().toISOString(),
        certificateId: `OURO-ESG-${new Date().getFullYear()}-${String(verifiedRecycledItems.length).padStart(4, '0')}`,
        totalVerifiedTons: totalVerifiedRecycledTons,
        totalVerifiedRecycledTons,
        totalDeliveredPendingTons,
        totalResidualAndLossTons,
        totalTransportEmissionsTons,
        totalCo2eAvoidedTons,
        estimatedPendingCo2eTons,
        methodologyDisclosure: {
          accountingPrinciple:
            'Only waste lots with Stage 7 Verified Recycling Outcomes are included in Verified Recycled Tonnage and Net CO2e Avoided totals. Listed and Delivered-only quantities are reported separately and NEVER counted as recycled.',
          formula:
            'Net Verified CO2e Avoided = (Verified Recovered Output Tons × Material Emission Factor) − (Delivered Tons × Corridor Distance km × Heavy-Duty Freight Factor / 1000)',
          dataConfidenceTiers: {
            verified: 'Backed by facility recycling evidence and weighbridge intake records.',
            calculated: 'Facility-confirmed recovered mass without uploaded certificate attachment.',
            estimated: 'Pre-recycling projection on Listed or Delivered-only shipments (excluded from verified totals).',
          },
        },
        emissionFactors: Object.values(factorMap).map((f) => ({
          category: f.materialCategory,
          label: f.labelEn,
          factor: f.co2eFactorPerTon,
          transportFactorKgPerTonKm: f.transportFactorKgPerTonKm,
          methodologyRef: `${f.methodologyName} (${f.version})`,
          sourceRef: f.sourceRef,
          boundaryNotes: f.boundaryNotes,
          baselineScenario: f.baselineScenario,
          dataQualityTier: f.dataQualityTier,
        })),
        items: verifiedRecycledItems,
        deliveredPendingItems: deliveredPendingRecyclingItems,
      });
    } catch (error) {
      console.error('ESG report error:', error);
      return res.status(500).json({ error: 'Failed to generate ESG environmental impact report.' });
    }
  }
);

app.get(
  '/api/esg/export.csv',
  requireAuth,
  requireRole('platform_admin', 'factory_procurement', 'generator_ops'),
  async (req: AuthRequest, res) => {
    try {
      const scopeCondition =
        req.authUser!.role === 'factory_procurement' && req.authUser!.factoryId
          ? and(
              eq(reservations.recyclingStatus, 'verified_recycled'),
              eq(reservations.factoryId, req.authUser!.factoryId)
            )
          : req.authUser!.role === 'generator_ops' && req.authUser!.hubId
          ? and(
              eq(reservations.recyclingStatus, 'verified_recycled'),
              eq(reservations.hubId, req.authUser!.hubId)
            )
          : eq(reservations.recyclingStatus, 'verified_recycled');

      const [rows, factorMap] = await Promise.all([
        db
          .select({
            reservation: reservations,
            passport: wastePassports,
            hub: wasteSourceHubs,
            factory: recyclingFactories,
            provider: logisticsProviders,
          })
          .from(reservations)
          .innerJoin(wastePassports, eq(reservations.passportId, wastePassports.id))
          .innerJoin(wasteSourceHubs, eq(reservations.hubId, wasteSourceHubs.id))
          .innerJoin(recyclingFactories, eq(reservations.factoryId, recyclingFactories.id))
          .innerJoin(logisticsProviders, eq(reservations.logisticsProviderId, logisticsProviders.id))
          .where(scopeCondition)
          .orderBy(desc(reservations.recycledAt)),
        getEmissionFactorMap(),
      ]);

      const headers = [
        'Passport_ID',
        'Reservation_Code',
        'Lifecycle_Status',
        'Waste_Generator_Code',
        'Waste_Generator_Name',
        'Governorate',
        'Recycling_Factory',
        'Factory_Tax_ID',
        '3PL_Provider',
        '3PL_Env_License_ID',
        'Material_Category',
        'Purity_Grade',
        'Delivered_Tons',
        'Verified_Recovered_Tons',
        'Residual_Tons',
        'Processing_Loss_Tons',
        'Transport_Distance_km',
        'Transport_Emissions_tCO2e',
        'Emission_Factor_tCO2e_per_Ton',
        'Methodology_Version',
        'Net_Verified_CO2e_Avoided_tCO2e',
        'ESG_Confidence_Tier',
        'Recycled_Verified_At_UTC',
      ];

      const lines = [headers.join(',')];
      for (const r of rows) {
        const f = factorMap[r.passport.materialCategory];
        const delivTons = r.reservation.receivedWeightKg
          ? Number((r.reservation.receivedWeightKg / 1000).toFixed(3))
          : r.reservation.quantityTons;
        lines.push(
          [
            r.passport.passportCode,
            r.reservation.reservationCode,
            'RECYCLED',
            r.hub.code,
            r.hub.nameEn,
            r.hub.governorate,
            r.factory.nameEn,
            r.factory.taxId,
            r.provider.nameEn,
            r.provider.envTransportLicenseId,
            f?.labelEn || r.passport.materialCategory,
            r.passport.purityGrade,
            delivTons,
            r.reservation.recoveredTons,
            r.reservation.residualTons,
            r.reservation.lossTons,
            r.reservation.transportDistanceKm,
            r.reservation.transportEmissionsTons,
            f?.co2eFactorPerTon ?? r.passport.co2eFactorPerTon,
            f?.version || r.passport.emissionFactorVersion,
            r.reservation.co2eAvoidedTons,
            r.reservation.esgConfidenceLevel,
            r.reservation.recycledAt ? new Date(r.reservation.recycledAt).toISOString() : '',
          ]
            .map(sanitizeCsvCell)
            .join(',')
        );
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="OURO_ESG_Verified_Recycled_Ledger_${new Date().toISOString().slice(0, 10)}.csv"`
      );
      return res.send(lines.join('\n'));
    } catch (error) {
      console.error('ESG CSV export error:', error);
      return res.status(500).json({ error: 'Failed to export ESG CSV ledger.' });
    }
  }
);

// Public liveness probe (no internal status leaked)
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Centralized Express error handler (prevents leaking stack traces or Multer internals)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.message?.includes('Unsupported file type')) {
    return res.status(400).json({ error: err.message });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File exceeds the maximum 8 MB upload limit.' });
  }
  logStructured('error', 'unhandled_express_error', { message: err?.message || 'Unknown error' });
  return res.status(500).json({ error: 'An unexpected server error occurred. Please retry.' });
});

// ============================================================================
// SERVER STARTUP (VITE MIDDLEWARE IN DEV, STATIC DIST IN PRODUCTION)
// ============================================================================

async function startServer() {
  const PORT = 3000;
  const isProd = process.env.NODE_ENV === 'production';
  const httpServer = http.createServer(app);

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    logStructured('info', 'server_started', { port: PORT, mode: isProd ? 'production' : 'development' });
  });
}

startServer().catch((err) => {
  console.error('Failed to start OURO server:', err);
  process.exit(1);
});

import { Router } from 'express';
import { asc, count, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  adminAuditLogs,
  disputes,
  emissionFactors,
  fileObjects,
  logisticsProviders,
  logisticsVehicles,
  notifications,
  recyclingFactories,
  reservations,
  users,
  wastePassports,
  wasteSourceHubs,
} from '../db/schema.ts';
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth.ts';
import { dispatchNotification, getEmailProviderStatus, notifyOrganization } from '../lib/notifications.ts';
import { DISPUTE_CATEGORIES, VEHICLE_TYPES, type UserRole } from '../shared/constants.ts';

export const platformRouter = Router();

// ============================================================================
// 1. 3PL EXTERNAL VEHICLE REGISTRY (ASSET-LIGHT 3PL PARTNERS ONLY)
// ============================================================================

platformRouter.get(
  '/api/driver/vehicles',
  requireAuth,
  requireRole('driver_3pl', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const providerId = req.authUser!.logisticsProviderId;
      const rows =
        req.authUser!.role === 'driver_3pl' && providerId
          ? await db
              .select()
              .from(logisticsVehicles)
              .where(eq(logisticsVehicles.logisticsProviderId, providerId))
              .orderBy(desc(logisticsVehicles.createdAt))
          : await db.select().from(logisticsVehicles).orderBy(desc(logisticsVehicles.createdAt));

      return res.json({ vehicles: rows });
    } catch (error) {
      console.error('List 3PL vehicles error:', error);
      return res.status(500).json({ error: 'Failed to load 3PL vehicles.' });
    }
  }
);

platformRouter.post(
  '/api/driver/vehicles',
  requireAuth,
  requireRole('driver_3pl', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const { plateNumber, vehicleType, capacityTons, envPermitNo, permitExpiry, driverName, logisticsProviderId } =
        req.body || {};

      const targetProviderId =
        req.authUser!.role === 'platform_admin' && Number(logisticsProviderId) > 0
          ? Number(logisticsProviderId)
          : req.authUser!.logisticsProviderId;

      if (!targetProviderId) {
        return res.status(400).json({ error: 'No 3PL logistics provider linked to this account.' });
      }
      if (!plateNumber || String(plateNumber).trim().length < 4) {
        return res.status(400).json({ error: 'Valid vehicle plate number is required.' });
      }
      if (!envPermitNo || String(envPermitNo).trim().length < 4) {
        return res.status(400).json({ error: 'Environmental transport permit number is required.' });
      }
      const cap = Number(capacityTons);
      if (!Number.isFinite(cap) || cap <= 0 || cap > 60) {
        return res.status(400).json({ error: 'Vehicle payload capacity must be between 1 and 60 tons.' });
      }
      const safeType = VEHICLE_TYPES.some((v) => v.value === vehicleType) ? vehicleType : 'box_truck';

      const [created] = await db
        .insert(logisticsVehicles)
        .values({
          logisticsProviderId: targetProviderId,
          plateNumber: String(plateNumber).trim().toUpperCase(),
          vehicleType: safeType,
          capacityTons: cap,
          envPermitNo: String(envPermitNo).trim().toUpperCase(),
          permitExpiry: String(permitExpiry || '2028-12-31').trim(),
          driverName: driverName ? String(driverName).trim() : req.authUser!.fullName,
          verificationStatus: 'verified',
          isActive: true,
        })
        .returning();

      return res.status(201).json({ vehicle: created });
    } catch (error) {
      console.error('Register 3PL vehicle error:', error);
      return res.status(500).json({ error: 'Failed to register 3PL vehicle.' });
    }
  }
);

// ============================================================================
// 2. IN-APP NOTIFICATIONS (WITH HONEST EMAIL PROVIDER STATUS)
// ============================================================================

platformRouter.get('/api/notifications', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.authUser!.id;
    const role = req.authUser!.role;
    const rows = await db
      .select()
      .from(notifications)
      .where(or(eq(notifications.userId, userId), eq(notifications.targetRole, role)))
      .orderBy(desc(notifications.createdAt))
      .limit(35);

    const unreadCount = rows.filter((n) => !n.isRead).length;
    return res.json({
      notifications: rows,
      unreadCount,
      emailProviderStatus: getEmailProviderStatus(),
    });
  } catch (error) {
    console.error('Load notifications error:', error);
    return res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

platformRouter.patch('/api/notifications/:id/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid notification ID.' });
    }
    const existing = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    const n = existing[0];
    if (n.userId !== req.authUser!.id && n.targetRole !== req.authUser!.role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const [updated] = await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id))
      .returning();
    return res.json({ notification: updated });
  } catch (error) {
    console.error('Mark notification read error:', error);
    return res.status(500).json({ error: 'Failed to update notification.' });
  }
});

platformRouter.post('/api/notifications/read-all', requireAuth, async (req: AuthRequest, res) => {
  try {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(or(eq(notifications.userId, req.authUser!.id), eq(notifications.targetRole, req.authUser!.role)));
    return res.json({ ok: true });
  } catch (error) {
    console.error('Read-all notifications error:', error);
    return res.status(500).json({ error: 'Failed to mark notifications as read.' });
  }
});

// ============================================================================
// 3. DISPUTE & ISSUE RESOLUTION WORKFLOW
// ============================================================================

platformRouter.get('/api/disputes', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.authUser!;
    const rows =
      user.role === 'platform_admin'
        ? await db.select().from(disputes).orderBy(desc(disputes.createdAt)).limit(50)
        : await db
            .select()
            .from(disputes)
            .where(eq(disputes.raisedByUserId, user.id))
            .orderBy(desc(disputes.createdAt))
            .limit(30);

    return res.json({ disputes: rows });
  } catch (error) {
    console.error('List disputes error:', error);
    return res.status(500).json({ error: 'Failed to load disputes.' });
  }
});

platformRouter.post('/api/disputes', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { reservationId, passportId, category, subject, description } = req.body || {};
    if (!subject || String(subject).trim().length < 4) {
      return res.status(400).json({ error: 'Dispute subject must be at least 4 characters.' });
    }
    if (!description || String(description).trim().length < 10) {
      return res.status(400).json({ error: 'Please provide detailed issue description (minimum 10 characters).' });
    }

    const validCategory = DISPUTE_CATEGORIES.some((c) => c.value === category) ? category : 'other';
    const disputeCode = `OURO-DSP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const cleanSubject = String(subject).trim().slice(0, 180);
    const cleanDesc = String(description).trim().slice(0, 1800);
    const orgLabel = `${req.authUser!.fullName} (${req.authUser!.role})`;

    const [created] = await db
      .insert(disputes)
      .values({
        disputeCode,
        reservationId: reservationId ? Number(reservationId) : null,
        passportId: passportId ? Number(passportId) : null,
        raisedByUserId: req.authUser!.id,
        raisedByOrgName: orgLabel,
        category: validCategory,
        severity: 'medium',
        status: 'open',
        description: `[${cleanSubject}] ${cleanDesc}`,
      })
      .returning();

    await dispatchNotification({
      targetRole: 'platform_admin',
      type: 'dispute',
      titleEn: `New Dispute Opened (${disputeCode})`,
      titleAr: `تم فتح نزاع تشغيلي جديد (${disputeCode})`,
      messageEn: `${req.authUser!.fullName}: ${cleanSubject}`,
      messageAr: `${req.authUser!.fullName}: ${cleanSubject}`,
      entityType: 'dispute',
      entityId: String(created.id),
    });

    return res.status(201).json({ dispute: created });
  } catch (error) {
    console.error('Create dispute error:', error);
    return res.status(500).json({ error: 'Failed to submit dispute.' });
  }
});

platformRouter.patch(
  '/api/admin/disputes/:id',
  requireAuth,
  requireRole('platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const { status, resolutionNote } = req.body || {};
      const validStatuses = ['open', 'investigating', 'resolved', 'dismissed'];
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid dispute ID.' });
      }
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid dispute status.' });
      }
      if ((status === 'resolved' || status === 'dismissed') && (!resolutionNote || String(resolutionNote).trim().length < 5)) {
        return res.status(400).json({ error: 'Resolution note (min 5 characters) is required to close a dispute.' });
      }

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(disputes)
          .set({
            status,
            resolutionNote: resolutionNote ? String(resolutionNote).trim() : null,
            resolvedByEmail: status === 'resolved' || status === 'dismissed' ? req.authUser!.email : null,
            resolvedAt: status === 'resolved' || status === 'dismissed' ? new Date() : null,
          })
          .where(eq(disputes.id, id))
          .returning();

        if (!row) throw new Error('DISPUTE_NOT_FOUND');

        await tx.insert(adminAuditLogs).values({
          action: `DISPUTE_${String(status).toUpperCase()}`,
          targetType: 'dispute',
          targetId: String(row.id),
          actorEmail: req.authUser!.email,
          reason: `${row.disputeCode}: ${resolutionNote ? String(resolutionNote).trim() : `Status changed to ${status}`}`,
        });

        await dispatchNotification(
          {
            userId: row.raisedByUserId,
            type: 'dispute',
            titleEn: `Dispute ${row.disputeCode} Updated: ${status}`,
            titleAr: `تحديث حالة النزاع ${row.disputeCode}: ${status}`,
            messageEn: row.resolutionNote || `Platform operations updated status to ${status}.`,
            messageAr: row.resolutionNote || `تم تحديث حالة النزاع إلى ${status}.`,
            entityType: 'dispute',
            entityId: String(row.id),
          },
          tx
        );

        return row;
      });

      return res.json({ dispute: updated });
    } catch (error: any) {
      if (error?.message === 'DISPUTE_NOT_FOUND') {
        return res.status(404).json({ error: 'Dispute not found.' });
      }
      console.error('Update dispute error:', error);
      return res.status(500).json({ error: 'Failed to update dispute.' });
    }
  }
);

// ============================================================================
// 4. ADMIN GOVERNANCE: USERS, 3PL VERIFICATION, EMISSION FACTORS & SYSTEM HEALTH
// ============================================================================

platformRouter.patch(
  '/api/admin/users/:id',
  requireAuth,
  requireRole('platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const targetUserId = Number(req.params.id);
      const { role, isActive, reason } = req.body || {};
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({ error: 'Invalid user ID.' });
      }
      if (targetUserId === req.authUser!.id && isActive === false) {
        return res.status(400).json({ error: 'You cannot deactivate your own active administrator account.' });
      }

      const validRoles: UserRole[] = [
        'generator_ops',
        'factory_procurement',
        'driver_3pl',
        'platform_admin',
      ];
      const updates: Partial<typeof users.$inferInsert> = {};
      if (typeof isActive === 'boolean') updates.isActive = isActive;
      if (role && validRoles.includes(role)) updates.role = role;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid user updates provided.' });
      }

      const updated = await db.transaction(async (tx) => {
        const [u] = await tx
          .update(users)
          .set(updates)
          .where(eq(users.id, targetUserId))
          .returning({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            role: users.role,
            accountCode: users.accountCode,
            isActive: users.isActive,
          });

        if (!u) throw new Error('USER_NOT_FOUND');

        await tx.insert(adminAuditLogs).values({
          action: 'USER_ACCOUNT_UPDATED',
          targetType: 'user',
          targetId: String(u.id),
          actorEmail: req.authUser!.email,
          reason:
            reason && String(reason).trim()
              ? String(reason).trim()
              : `Updated ${u.email} (role=${u.role}, isActive=${u.isActive}).`,
        });

        return u;
      });

      return res.json({ user: updated });
    } catch (error: any) {
      if (error?.message === 'USER_NOT_FOUND') {
        return res.status(404).json({ error: 'User account not found.' });
      }
      console.error('Admin update user error:', error);
      return res.status(500).json({ error: 'Failed to update user account.' });
    }
  }
);

platformRouter.patch(
  '/api/admin/providers/:id/verify',
  requireAuth,
  requireRole('platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const providerId = Number(req.params.id);
      const { status, reason } = req.body || {};
      if (!Number.isInteger(providerId) || providerId <= 0) {
        return res.status(400).json({ error: 'Invalid 3PL provider ID.' });
      }
      if (!['approved', 'suspended', 'pending'].includes(status)) {
        return res.status(400).json({ error: 'Status must be approved, suspended, or pending.' });
      }
      if (!reason || String(reason).trim().length < 5) {
        return res.status(400).json({ error: 'Audit reason (min 5 characters) is required.' });
      }

      const updated = await db.transaction(async (tx) => {
        const [prov] = await tx
          .update(logisticsProviders)
          .set({
            verificationStatus: status,
            isVerified: status === 'approved',
          })
          .where(eq(logisticsProviders.id, providerId))
          .returning();

        if (!prov) throw new Error('PROVIDER_NOT_FOUND');

        await tx.insert(adminAuditLogs).values({
          action: `PROVIDER_3PL_${String(status).toUpperCase()}`,
          targetType: 'logistics_provider',
          targetId: String(prov.id),
          actorEmail: req.authUser!.email,
          reason: `${prov.nameEn} (${prov.envTransportLicenseId}): ${String(reason).trim()}`,
        });

        await notifyOrganization(
          { logisticsProviderId: prov.id },
          {
            type: 'system',
            titleEn: `3PL License Verification: ${status.toUpperCase()}`,
            titleAr: `تحديث اعتماد شركة النقل: ${status}`,
            messageEn: String(reason).trim(),
            messageAr: String(reason).trim(),
            entityType: 'logistics_provider',
            entityId: String(prov.id),
          },
          tx
        );

        return prov;
      });

      return res.json({ provider: updated });
    } catch (error: any) {
      if (error?.message === 'PROVIDER_NOT_FOUND') {
        return res.status(404).json({ error: '3PL provider not found.' });
      }
      console.error('Verify 3PL provider error:', error);
      return res.status(500).json({ error: 'Failed to update 3PL provider verification.' });
    }
  }
);

platformRouter.get('/api/emission-factors', requireAuth, async (_req, res) => {
  try {
    const rows = await db.select().from(emissionFactors).orderBy(asc(emissionFactors.materialCategory));
    return res.json({ emissionFactors: rows });
  } catch (error) {
    console.error('List emission factors error:', error);
    return res.status(500).json({ error: 'Failed to load emission factors.' });
  }
});

platformRouter.patch(
  '/api/admin/emission-factors/:category',
  requireAuth,
  requireRole('platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const category = String(req.params.category).trim();
      const {
        co2eFactorPerTon,
        transportFactorKgPerTonKm,
        methodologyName,
        sourceRef,
        version,
        boundaryNotes,
        baselineScenario,
        dataQualityTier,
        reason,
      } = req.body || {};

      const factorNum = Number(co2eFactorPerTon);
      const transportNum = Number(transportFactorKgPerTonKm);
      if (!Number.isFinite(factorNum) || factorNum <= 0 || factorNum > 25) {
        return res.status(400).json({ error: 'CO2e emission factor must be between 0.01 and 25 tCO2e/ton.' });
      }
      if (!Number.isFinite(transportNum) || transportNum < 0 || transportNum > 2) {
        return res.status(400).json({ error: 'Transport factor must be between 0 and 2 kg CO2e/ton-km.' });
      }

      const updated = await db.transaction(async (tx) => {
        const [ef] = await tx
          .update(emissionFactors)
          .set({
            co2eFactorPerTon: Number(factorNum.toFixed(3)),
            transportFactorKgPerTonKm: Number(transportNum.toFixed(4)),
            methodologyName: methodologyName ? String(methodologyName).trim() : undefined,
            sourceRef: sourceRef ? String(sourceRef).trim() : undefined,
            version: version ? String(version).trim() : undefined,
            boundaryNotes: boundaryNotes ? String(boundaryNotes).trim() : undefined,
            baselineScenario: baselineScenario ? String(baselineScenario).trim() : undefined,
            dataQualityTier: dataQualityTier ? String(dataQualityTier).trim() : undefined,
            updatedByEmail: req.authUser!.email,
            updatedAt: new Date(),
          })
          .where(eq(emissionFactors.materialCategory, category))
          .returning();

        if (!ef) throw new Error('FACTOR_NOT_FOUND');

        await tx.insert(adminAuditLogs).values({
          action: 'EMISSION_FACTOR_UPDATED',
          targetType: 'emission_factor',
          targetId: category,
          actorEmail: req.authUser!.email,
          reason:
            reason && String(reason).trim()
              ? String(reason).trim()
              : `Updated ${category} factor to ${ef.co2eFactorPerTon} tCO2e/t (${ef.version}).`,
        });

        return ef;
      });

      return res.json({ emissionFactor: updated });
    } catch (error: any) {
      if (error?.message === 'FACTOR_NOT_FOUND') {
        return res.status(404).json({ error: 'Emission factor category not found.' });
      }
      console.error('Update emission factor error:', error);
      return res.status(500).json({ error: 'Failed to update emission factor.' });
    }
  }
);

platformRouter.get(
  '/api/admin/system-health',
  requireAuth,
  requireRole('platform_admin'),
  async (_req, res) => {
    try {
      const start = Date.now();
      await db.execute(sql`SELECT 1`);
      const dbLatencyMs = Date.now() - start;

      const [hubC, facC, provC, vehC, passC, resC, userC, fileC, dispC] = await Promise.all([
        db.select({ c: count() }).from(wasteSourceHubs),
        db.select({ c: count() }).from(recyclingFactories),
        db.select({ c: count() }).from(logisticsProviders),
        db.select({ c: count() }).from(logisticsVehicles),
        db.select({ c: count() }).from(wastePassports),
        db.select({ c: count() }).from(reservations),
        db.select({ c: count() }).from(users),
        db.select({ c: count() }).from(fileObjects),
        db.select({ c: count() }).from(disputes),
      ]);

      return res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        database: {
          connected: true,
          latencyMs: dbLatencyMs,
          tables: {
            wasteGenerators: hubC[0]?.c ?? 0,
            recyclingFactories: facC[0]?.c ?? 0,
            logisticsProviders: provC[0]?.c ?? 0,
            logisticsVehicles: vehC[0]?.c ?? 0,
            digitalWastePassports: passC[0]?.c ?? 0,
            reservations: resC[0]?.c ?? 0,
            users: userC[0]?.c ?? 0,
            storedFiles: fileC[0]?.c ?? 0,
            disputes: dispC[0]?.c ?? 0,
          },
        },
        storage: {
          mode: 'confined_private_disk_with_signed_urls',
          magicByteValidation: true,
          sha256Integrity: true,
        },
        notifications: getEmailProviderStatus(),
      });
    } catch (error) {
      console.error('System health check error:', error);
      return res.status(503).json({ status: 'degraded', error: 'Database connectivity check failed.' });
    }
  }
);

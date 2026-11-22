import { Router } from 'express';
import { and, asc, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
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
import { getStorageHealth } from '../lib/storage.ts';
import {
  getCacheProvider,
  getDatabaseProvider,
  getJobQueue,
  logger,
} from '../infra/index.ts';
import { appendHashedPassportEvents } from '../lib/passport-chain.ts';
import { calculateVerifiedRecyclingImpact, getEmissionFactorForCategory } from '../lib/esg-engine.ts';
import { DISPUTE_CATEGORIES, VEHICLE_TYPES, haversineKm, type UserRole } from '../shared/constants.ts';

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
      const isAdmin = req.authUser!.role === 'platform_admin';
      const providerId = req.authUser!.logisticsProviderId;
      if (!isAdmin && !providerId) {
        return res.status(403).json({
          error: 'Forbidden: No 3PL logistics provider organization is linked to this account.',
        });
      }
      const rows = isAdmin
        ? await db.select().from(logisticsVehicles).orderBy(desc(logisticsVehicles.createdAt))
        : await db
            .select()
            .from(logisticsVehicles)
            .where(eq(logisticsVehicles.logisticsProviderId, providerId!))
            .orderBy(desc(logisticsVehicles.createdAt));

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
    // Strict user-level isolation: return only notifications addressed to this user OR role-wide broadcasts (userId IS NULL)
    const rows = await db
      .select()
      .from(notifications)
      .where(
        or(
          eq(notifications.userId, userId),
          and(isNull(notifications.userId), eq(notifications.targetRole, role))
        )
      )
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
    const isOwner = n.userId === req.authUser!.id;
    const isRoleBroadcast = n.userId === null && n.targetRole === req.authUser!.role;
    if (!isOwner && !isRoleBroadcast) {
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
      .where(
        or(
          eq(notifications.userId, req.authUser!.id),
          and(isNull(notifications.userId), eq(notifications.targetRole, req.authUser!.role))
        )
      );
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
    const parsedReservationId = reservationId ? Number(reservationId) : null;
    const parsedPassportId = passportId ? Number(passportId) : null;

    if (parsedReservationId !== null && (!Number.isInteger(parsedReservationId) || parsedReservationId <= 0)) {
      return res.status(400).json({ error: 'Invalid reservation ID.' });
    }
    if (parsedPassportId !== null && (!Number.isInteger(parsedPassportId) || parsedPassportId <= 0)) {
      return res.status(400).json({ error: 'Invalid passport ID.' });
    }

    const user = req.authUser!;
    const isAdmin = user.role === 'platform_admin';

    if (parsedReservationId !== null) {
      const [resRow] = await db
        .select({
          id: reservations.id,
          hubId: reservations.hubId,
          factoryId: reservations.factoryId,
          logisticsProviderId: reservations.logisticsProviderId,
        })
        .from(reservations)
        .where(eq(reservations.id, parsedReservationId))
        .limit(1);
      if (!resRow) {
        return res.status(404).json({ error: 'Referenced reservation not found.' });
      }
      const isParty =
        isAdmin ||
        (user.hubId && resRow.hubId === user.hubId) ||
        (user.factoryId && resRow.factoryId === user.factoryId) ||
        (user.logisticsProviderId && resRow.logisticsProviderId === user.logisticsProviderId);
      if (!isParty) {
        return res.status(403).json({
          error: 'Forbidden: Your organization is not a party to the referenced reservation.',
        });
      }
    }

    if (parsedPassportId !== null) {
      const [pasRow] = await db
        .select({ id: wastePassports.id, hubId: wastePassports.hubId })
        .from(wastePassports)
        .where(eq(wastePassports.id, parsedPassportId))
        .limit(1);
      if (!pasRow) {
        return res.status(404).json({ error: 'Referenced Digital Waste Passport not found.' });
      }
      let isPassportParty = isAdmin || Boolean(user.hubId && pasRow.hubId === user.hubId);
      if (!isPassportParty && (user.factoryId || user.logisticsProviderId)) {
        const linked = await db
          .select({
            factoryId: reservations.factoryId,
            logisticsProviderId: reservations.logisticsProviderId,
          })
          .from(reservations)
          .where(eq(reservations.passportId, parsedPassportId))
          .limit(20);
        isPassportParty = linked.some(
          (r) =>
            (user.factoryId && r.factoryId === user.factoryId) ||
            (user.logisticsProviderId && r.logisticsProviderId === user.logisticsProviderId)
        );
      }
      if (!isPassportParty) {
        return res.status(403).json({
          error: 'Forbidden: Your organization is not a party to the referenced Digital Waste Passport.',
        });
      }
    }

    const disputeCode = `OURO-DSP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const cleanSubject = String(subject).trim().slice(0, 180);
    const cleanDesc = String(description).trim().slice(0, 1800);
    const orgLabel = `${req.authUser!.fullName} (${req.authUser!.role})`;

    const [created] = await db
      .insert(disputes)
      .values({
        disputeCode,
        reservationId: parsedReservationId,
        passportId: parsedPassportId,
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

platformRouter.patch(
  '/api/admin/hubs/:id/verify',
  requireAuth,
  requireRole('platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const hubId = Number(req.params.id);
      const { status, reason } = req.body || {};
      if (!Number.isInteger(hubId) || hubId <= 0) {
        return res.status(400).json({ error: 'Invalid Waste Generator facility ID.' });
      }
      if (!['verified', 'suspended', 'pending'].includes(status)) {
        return res.status(400).json({ error: 'Status must be verified, suspended, or pending.' });
      }
      if (!reason || String(reason).trim().length < 5) {
        return res.status(400).json({ error: 'Mandatory audit review note (min 5 characters) is required.' });
      }

      const updated = await db.transaction(async (tx) => {
        const [hub] = await tx
          .update(wasteSourceHubs)
          .set({
            verificationStatus: status,
            isActive: status !== 'suspended',
          })
          .where(eq(wasteSourceHubs.id, hubId))
          .returning();

        if (!hub) throw new Error('HUB_NOT_FOUND');

        await tx.insert(adminAuditLogs).values({
          action: `GENERATOR_${String(status).toUpperCase()}`,
          targetType: 'waste_generator',
          targetId: String(hub.id),
          actorEmail: req.authUser!.email,
          reason: `${hub.nameEn} (${hub.code}): ${String(reason).trim()}`,
        });

        await notifyOrganization(
          { hubId: hub.id },
          {
            type: 'kyc',
            titleEn: `Facility Verification Updated: ${status.toUpperCase()}`,
            titleAr: `تحديث اعتماد المنشأة المولدة: ${status}`,
            messageEn: String(reason).trim(),
            messageAr: String(reason).trim(),
            entityType: 'waste_generator',
            entityId: String(hub.id),
          },
          tx
        );

        return hub;
      });

      return res.json({ hub: updated });
    } catch (error: any) {
      if (error?.message === 'HUB_NOT_FOUND') {
        return res.status(404).json({ error: 'Waste Generator facility not found.' });
      }
      console.error('Verify generator hub error:', error);
      return res.status(500).json({ error: 'Failed to update Waste Generator verification status.' });
    }
  }
);

platformRouter.post(
  '/api/admin/reservations/:id/verify-recycling',
  requireAuth,
  requireRole('platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const resId = Number(req.params.id);
      const { decision, reason } = req.body || {};

      if (!Number.isInteger(resId) || resId <= 0) {
        return res.status(400).json({ error: 'Invalid reservation ID.' });
      }
      if (decision !== 'approved' && decision !== 'rejected') {
        return res.status(400).json({ error: 'Decision must be "approved" or "rejected".' });
      }
      if (!reason || String(reason).trim().length < 5) {
        return res.status(400).json({ error: 'Mandatory verifier audit note (min 5 characters) is required.' });
      }

      const cleanReason = String(reason).trim().slice(0, 800);

      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM reservations WHERE id = ${resId} FOR UPDATE`);
        const rows = await tx.select().from(reservations).where(eq(reservations.id, resId)).limit(1);
        if (rows.length === 0) throw new Error('RESERVATION_NOT_FOUND');
        const current = rows[0];

        if (current.pickupStatus !== 'delivered') throw new Error('NOT_YET_DELIVERED');
        if (current.recyclingStatus === 'verified_recycled') throw new Error('ALREADY_VERIFIED');
        if (current.recyclingStatus !== 'submitted_for_verification' || current.recoveredTons <= 0) {
          throw new Error('NO_EVIDENCE_SUBMITTED');
        }

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

        if (decision === 'rejected') {
          const [rejectedRes] = await tx
            .update(reservations)
            .set({
              recyclingStatus: 'verification_rejected',
              co2eAvoidedTons: 0,
              esgConfidenceLevel: 'estimated',
              updatedAt: new Date(),
            })
            .where(eq(reservations.id, current.id))
            .returning();

          await appendHashedPassportEvents(tx, passport.id, [
            {
              stage: 6,
              eventType: 'RECYCLING_VERIFICATION_REJECTED',
              actorName: req.authUser!.fullName,
              actorRole: 'platform_admin',
              summaryEn: `Stage 7 recycling submission rejected by verifier (${req.authUser!.email}): ${cleanReason}. Passport remains DELIVERED pending resubmission.`,
              summaryAr: `تم رفض مستندات إعادة التدوير من قبل المراجع المعتمد: ${cleanReason}. الحالة تبقى "تم التسليم" لحين إعادة التقديم.`,
              metadataJson: JSON.stringify({ reservationCode: current.reservationCode, reason: cleanReason }),
            },
          ]);

          await tx.insert(adminAuditLogs).values({
            action: 'RECYCLING_VERIFICATION_REJECTED',
            targetType: 'reservation',
            targetId: String(current.id),
            actorEmail: req.authUser!.email,
            reason: `${current.reservationCode} (${passport.passportCode}): ${cleanReason}`,
          });

          await notifyOrganization(
            { factoryId: factory.id },
            {
              type: 'recycling',
              titleEn: `Recycling Evidence Rejected (${current.reservationCode})`,
              titleAr: `تم رفض إثبات إعادة التدوير (${current.reservationCode})`,
              messageEn: `Verifier note: ${cleanReason}. Please upload corrected recycling evidence.`,
              messageAr: `ملاحظة المراجع: ${cleanReason}. يرجى إعادة رفع إثبات التدوير.`,
              entityType: 'passport',
              entityId: passport.passportCode,
            },
            tx
          );

          return { reservation: rejectedRes, passport, impact: null };
        }

        // Approved by independent verifier -> seal Stage 7 RECYCLED & verified net CO2e!
        const deliveredTonsBasis = current.receivedWeightKg
          ? Number((current.receivedWeightKg / 1000).toFixed(3))
          : current.handoffWeightKg
          ? Number((current.handoffWeightKg / 1000).toFixed(3))
          : current.quantityTons;

        const factor = await getEmissionFactorForCategory(passport.materialCategory);
        const distanceKm =
          current.transportDistanceKm > 0
            ? current.transportDistanceKm
            : Number(haversineKm(hub.lat, hub.lng, factory.lat, factory.lng).toFixed(1));

        const impact = calculateVerifiedRecyclingImpact({
          recoveredTons: current.recoveredTons,
          deliveredTons: deliveredTonsBasis,
          residualTons: current.residualTons,
          lossTons: current.lossTons,
          transportDistanceKm: distanceKm,
          factor,
          hasWeighbridgeTicket: Boolean(current.weighbridgeFileId && current.receivedWeightKg),
          hasRecyclingEvidence: Boolean(current.recyclingEvidenceFileId),
          verifierApproved: true,
        });

        const [approvedRes] = await tx
          .update(reservations)
          .set({
            recyclingStatus: 'verified_recycled',
            recycledAt: new Date(),
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
            actorName: `${req.authUser!.fullName} (OURO Verifier)`,
            actorRole: 'platform_admin',
            summaryEn: `Verifier approved Stage 7 recycling outcome for ${factory.nameEn}: ${impact.recoveredTons.toFixed(2)} t recovered (${impact.recoveryYieldPct}% yield), ${impact.residualTons.toFixed(2)} t residual, ${impact.lossTons.toFixed(2)} t loss. Net GHG avoided: ${impact.netVerifiedCo2eTons.toFixed(2)} tCO2e (Gross ${impact.grossRecyclingCo2eTons.toFixed(2)} - Road-Adjusted Freight ${impact.transportEmissionsTons.toFixed(3)} tCO2e; Tier: ${impact.confidenceLevel.toUpperCase()}). Note: ${cleanReason}`,
            summaryAr: `اعتمد المراجع المستقل المرحلة 7 لإعادة التدوير في ${factory.nameAr}: ${impact.recoveredTons.toFixed(2)} طن مستردة (${impact.recoveryYieldPct}%). صافي الانبعاثات المتجنبة: ${impact.netVerifiedCo2eTons.toFixed(2)} طن CO2e.`,
            metadataJson: JSON.stringify({ ...impact, verifierEmail: req.authUser!.email, verifierNote: cleanReason }),
            evidenceFileId: current.recyclingEvidenceFileId,
            lat: factory.lat,
            lng: factory.lng,
          },
        ]);

        await tx.insert(adminAuditLogs).values({
          action: 'RECYCLING_VERIFICATION_APPROVED',
          targetType: 'reservation',
          targetId: String(current.id),
          actorEmail: req.authUser!.email,
          reason: `${current.reservationCode} (${passport.passportCode}): ${impact.recoveredTons}t recovered, ${impact.netVerifiedCo2eTons} tCO2e (${impact.confidenceLevel}). ${cleanReason}`,
        });

        await notifyOrganization(
          { hubId: current.hubId },
          {
            type: 'recycling',
            titleEn: `Stage 7 Recycling Verified (${passport.passportCode})`,
            titleAr: `اعتماد إعادة التدوير — المرحلة 7 (${passport.passportCode})`,
            messageEn: `Verifier sealed ${impact.recoveredTons.toFixed(2)} t recovered output (${impact.netVerifiedCo2eTons.toFixed(2)} tCO2e net avoided).`,
            messageAr: `تم اعتماد استرداد ${impact.recoveredTons.toFixed(2)} طن وتجنب ${impact.netVerifiedCo2eTons.toFixed(2)} طن CO2e.`,
            entityType: 'passport',
            entityId: passport.passportCode,
          },
          tx
        );

        await notifyOrganization(
          { factoryId: factory.id },
          {
            type: 'recycling',
            titleEn: `Stage 7 ESG Certificate Sealed (${passport.passportCode})`,
            titleAr: `تم اعتماد شهادة التدوير البيئي (${passport.passportCode})`,
            messageEn: `Verifier approved ${impact.recoveredTons.toFixed(2)} t recovered output (${impact.netVerifiedCo2eTons.toFixed(2)} tCO2e net).`,
            messageAr: `تم اعتماد مخرجات التدوير (${impact.recoveredTons.toFixed(2)} طن) وإضافتها لشهادة ESG.`,
            entityType: 'passport',
            entityId: passport.passportCode,
          },
          tx
        );

        return { reservation: approvedRes, passport: savedPassport, impact };
      });

      return res.json(result);
    } catch (error: any) {
      const msg = String(error?.message || '');
      if (msg === 'RESERVATION_NOT_FOUND') return res.status(404).json({ error: 'Reservation not found.' });
      if (msg === 'NOT_YET_DELIVERED') return res.status(409).json({ error: 'Shipment has not been delivered yet.' });
      if (msg === 'ALREADY_VERIFIED') return res.status(409).json({ error: 'Recycling outcome is already verified.' });
      if (msg === 'NO_EVIDENCE_SUBMITTED') {
        return res.status(409).json({ error: 'No recycling evidence submission is pending verification for this shipment.' });
      }
      console.error('Admin verify recycling error:', error);
      return res.status(500).json({ error: 'Failed to process recycling verification decision.' });
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
      const [dbHealth, storageHealth, cacheHealth] = await Promise.all([
        getDatabaseProvider().healthCheck(),
        getStorageHealth(),
        getCacheProvider().healthCheck(),
      ]);

      if (!dbHealth.connected) {
        return res.status(503).json({ status: 'degraded', error: dbHealth.error || 'Database connectivity check failed.' });
      }

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
        status: storageHealth.healthy && cacheHealth.healthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        database: {
          connected: dbHealth.connected,
          latencyMs: dbHealth.latencyMs,
          connectionMode: dbHealth.connectionMode,
          sslMode: dbHealth.sslMode,
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
        storage: storageHealth,
        cache: cacheHealth,
        notifications: getEmailProviderStatus(),
        jobs: getJobQueue().getMetrics(),
        logging: logger.getStatus(),
      });
    } catch (error) {
      logger.error('system_health_check_error', { error });
      return res.status(503).json({ status: 'degraded', error: 'Database connectivity check failed.' });
    }
  }
);

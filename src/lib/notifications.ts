import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { notifications, users } from '../db/schema.ts';
import type { UserRole } from '../shared/constants.ts';

export interface NotificationInput {
  userId?: number | null;
  targetRole?: UserRole | null;
  type: 'reservation' | 'shipment' | 'delivery' | 'recycling' | 'kyc' | 'dispute' | 'system';
  titleEn: string;
  titleAr: string;
  messageEn: string;
  messageAr: string;
  entityType?: string;
  entityId?: string;
}

/**
 * Honest email provider configuration status.
 * Never fabricates email delivery unless real SMTP/Resend credentials exist in server env.
 */
export function getEmailProviderStatus(): {
  configured: boolean;
  provider: 'resend' | 'smtp' | 'none';
  note: string;
} {
  if (process.env.RESEND_API_KEY) {
    return {
      configured: true,
      provider: 'resend',
      note: 'Resend API key detected; transactional email dispatch enabled.',
    };
  }
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      configured: true,
      provider: 'smtp',
      note: `SMTP relay configured (${process.env.SMTP_HOST}).`,
    };
  }
  return {
    configured: false,
    provider: 'none',
    note: 'In-app notifications active. External email delivery is unconfigured (set RESEND_API_KEY or SMTP_HOST/USER/PASS in server secrets to enable).',
  };
}

/**
 * Creates a persistent in-app notification row in PostgreSQL.
 */
export async function dispatchNotification(input: NotificationInput, txOrDb: any = db) {
  try {
    await txOrDb.insert(notifications).values({
      userId: input.userId ?? null,
      targetRole: input.targetRole ?? null,
      type: input.type,
      titleEn: input.titleEn,
      titleAr: input.titleAr,
      messageEn: input.messageEn,
      messageAr: input.messageAr,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      isRead: false,
    });
  } catch (err) {
    console.error('Notification dispatch failed (non-blocking):', err);
  }
}

/**
 * Dispatches notifications to all users belonging to a specific organization (hub, factory, or 3PL provider).
 */
export async function notifyOrganization(
  org: { hubId?: number; factoryId?: number; logisticsProviderId?: number },
  payload: Omit<NotificationInput, 'userId' | 'targetRole'>,
  txOrDb: any = db
) {
  try {
    let targetUsers: Array<{ id: number }> = [];
    if (org.hubId) {
      targetUsers = await txOrDb
        .select({ id: users.id })
        .from(users)
        .where(eq(users.hubId, org.hubId));
    } else if (org.factoryId) {
      targetUsers = await txOrDb
        .select({ id: users.id })
        .from(users)
        .where(eq(users.factoryId, org.factoryId));
    } else if (org.logisticsProviderId) {
      targetUsers = await txOrDb
        .select({ id: users.id })
        .from(users)
        .where(eq(users.logisticsProviderId, org.logisticsProviderId));
    }

    for (const u of targetUsers) {
      await dispatchNotification({ ...payload, userId: u.id }, txOrDb);
    }
  } catch (err) {
    console.error('Organization notification dispatch failed (non-blocking):', err);
  }
}

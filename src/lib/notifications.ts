import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { notifications, users } from '../db/schema.ts';
import { getEmailProvider, type EmailProviderStatus } from '../infra/email/index.ts';
import { getJobQueue } from '../infra/jobs/index.ts';
import { logger } from '../infra/logger.ts';
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
 * Honest email provider configuration status delegated to the cloud-agnostic EmailProvider.
 */
export function getEmailProviderStatus(): EmailProviderStatus {
  return getEmailProvider().getStatus();
}

/**
 * Creates a persistent in-app notification row in PostgreSQL and, if an external email provider
 * is configured, enqueues a non-blocking transactional email job via the cloud-agnostic JobQueue.
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

    const emailStatus = getEmailProvider().getStatus();
    if (emailStatus.configured && input.userId) {
      const recipientRows = await db
        .select({ email: users.email, language: users.language })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      const recipient = recipientRows[0];
      if (recipient?.email) {
        const useAr = recipient.language === 'ar';
        await getJobQueue().enqueue('email.send', {
          to: recipient.email,
          subject: `[OURO] ${useAr ? input.titleAr : input.titleEn}`,
          text: `${useAr ? input.messageAr : input.messageEn}\n\n— OURO Digital Waste Management Platform`,
        });
      }
    }
  } catch (err) {
    logger.error('notification_dispatch_failed', { error: err, type: input.type });
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
    logger.error('organization_notification_dispatch_failed', { error: err, org });
  }
}


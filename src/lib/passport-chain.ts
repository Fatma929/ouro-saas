import crypto from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { passportEvents } from '../db/schema.ts';

export interface HashablePassportEvent {
  passportId: number;
  stage: number;
  eventType: string;
  actorName: string;
  actorRole: string;
  summaryEn: string;
  metadataJson?: string | null;
  evidenceFileId?: number | null;
}

/**
 * Computes a deterministic SHA-256 hash chaining each Digital Waste Passport event
 * to its immediate predecessor. Any post-hoc edit or deletion breaks verification.
 */
export function computePassportEventHash(prevHash: string, ev: HashablePassportEvent): string {
  const canonical = [
    prevHash || 'GENESIS',
    String(ev.passportId),
    String(ev.stage),
    ev.eventType,
    ev.actorName,
    ev.actorRole,
    ev.summaryEn,
    ev.metadataJson || '',
    ev.evidenceFileId ? String(ev.evidenceFileId) : '',
  ].join('|');

  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Appends one or more chronologically chained events inside an active DB transaction.
 */
export async function appendHashedPassportEvents(
  tx: any,
  passportId: number,
  eventsToInsert: Array<{
    stage: number;
    eventType: string;
    actorName: string;
    actorRole: string;
    summaryEn: string;
    summaryAr: string;
    metadataJson?: string | null;
    evidenceFileId?: number | null;
    lat?: number | null;
    lng?: number | null;
  }>
) {
  const latest = await tx
    .select({ eventHash: passportEvents.eventHash })
    .from(passportEvents)
    .where(eq(passportEvents.passportId, passportId))
    .orderBy(desc(passportEvents.id))
    .limit(1);

  let prevHash = latest[0]?.eventHash || 'GENESIS';
  const inserted: any[] = [];

  for (const ev of eventsToInsert) {
    const eventHash = computePassportEventHash(prevHash, {
      passportId,
      stage: ev.stage,
      eventType: ev.eventType,
      actorName: ev.actorName,
      actorRole: ev.actorRole,
      summaryEn: ev.summaryEn,
      metadataJson: ev.metadataJson ?? null,
      evidenceFileId: ev.evidenceFileId ?? null,
    });

    const [row] = await tx
      .insert(passportEvents)
      .values({
        passportId,
        stage: ev.stage,
        eventType: ev.eventType,
        actorName: ev.actorName,
        actorRole: ev.actorRole,
        summaryEn: ev.summaryEn,
        summaryAr: ev.summaryAr,
        metadataJson: ev.metadataJson ?? null,
        evidenceFileId: ev.evidenceFileId ?? null,
        lat: ev.lat ?? null,
        lng: ev.lng ?? null,
        prevHash,
        eventHash,
      })
      .returning();

    inserted.push(row);
    prevHash = eventHash;
  }

  return inserted;
}

export interface HashChainVerificationResult {
  valid: boolean;
  eventCount: number;
  latestHash: string | null;
  brokenAtEventId: number | null;
  algorithm: 'SHA-256';
}

/**
 * Verifies the cryptographic SHA-256 hash chain for a Digital Waste Passport's events
 * ordered strictly by insertion sequence (id ASC).
 */
export function verifyPassportHashChain(
  eventsOrderedByIdAsc: Array<{
    id: number;
    passportId: number;
    stage: number;
    eventType: string;
    actorName: string;
    actorRole: string;
    summaryEn: string;
    metadataJson: string | null;
    evidenceFileId: number | null;
    prevHash: string;
    eventHash: string;
  }>
): HashChainVerificationResult {
  if (eventsOrderedByIdAsc.length === 0) {
    return {
      valid: true,
      eventCount: 0,
      latestHash: null,
      brokenAtEventId: null,
      algorithm: 'SHA-256',
    };
  }

  let expectedPrev = 'GENESIS';
  for (const ev of eventsOrderedByIdAsc) {
    if (!ev.eventHash || ev.prevHash !== expectedPrev) {
      return {
        valid: false,
        eventCount: eventsOrderedByIdAsc.length,
        latestHash: eventsOrderedByIdAsc[eventsOrderedByIdAsc.length - 1]?.eventHash || null,
        brokenAtEventId: ev.id,
        algorithm: 'SHA-256',
      };
    }
    const recomputed = computePassportEventHash(expectedPrev, {
      passportId: ev.passportId,
      stage: ev.stage,
      eventType: ev.eventType,
      actorName: ev.actorName,
      actorRole: ev.actorRole,
      summaryEn: ev.summaryEn,
      metadataJson: ev.metadataJson,
      evidenceFileId: ev.evidenceFileId,
    });
    if (recomputed !== ev.eventHash) {
      return {
        valid: false,
        eventCount: eventsOrderedByIdAsc.length,
        latestHash: eventsOrderedByIdAsc[eventsOrderedByIdAsc.length - 1]?.eventHash || null,
        brokenAtEventId: ev.id,
        algorithm: 'SHA-256',
      };
    }
    expectedPrev = ev.eventHash;
  }

  return {
    valid: true,
    eventCount: eventsOrderedByIdAsc.length,
    latestHash: expectedPrev,
    brokenAtEventId: null,
    algorithm: 'SHA-256',
  };
}

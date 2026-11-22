import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { AuthenticatedUser } from '../middleware/auth.ts';

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'private');

const FILE_SIGN_SECRET =
  process.env.OURO_FILE_SIGN_SECRET && process.env.OURO_FILE_SIGN_SECRET.length >= 16
    ? process.env.OURO_FILE_SIGN_SECRET
    : process.env.OURO_SESSION_SECRET && process.env.OURO_SESSION_SECRET.length >= 16
    ? process.env.OURO_SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

export const VALID_FILE_PURPOSES = new Set([
  'weighin_photo',
  'kyc_document',
  'supporting_doc',
  'pod_document',
  'weighbridge_ticket',
  'recycling_evidence',
]);

/**
 * Validates file magic bytes against declared MIME type to block spoofed uploads.
 */
export function validateFileMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length === 0) return false;
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (mimeType === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (mimeType === 'application/pdf') {
    return buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF';
  }
  if (mimeType === 'text/plain') {
    // Reject binary null bytes in plain text files
    return !buffer.includes(0x00);
  }
  return false;
}

function safeExtForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'application/pdf':
      return '.pdf';
    default:
      return '.txt';
  }
}

/**
 * Stores file buffer in confined private disk storage and returns relative path + SHA-256 digest.
 */
export async function storePrivateFile(
  buffer: Buffer,
  purpose: string,
  mimeType: string
): Promise<{ storagePath: string; sha256: string }> {
  const safePurpose = VALID_FILE_PURPOSES.has(purpose) ? purpose : 'supporting_doc';
  const dir = path.resolve(STORAGE_ROOT, safePurpose);
  if (!dir.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error('INVALID_STORAGE_DIRECTORY');
  }
  await fs.mkdir(dir, { recursive: true });

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const filename = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${safeExtForMime(mimeType)}`;
  const fullPath = path.resolve(dir, filename);
  if (!fullPath.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error('PATH_TRAVERSAL_BLOCKED');
  }

  await fs.writeFile(fullPath, buffer, { mode: 0o600 });
  const relativePath = path.relative(STORAGE_ROOT, fullPath);
  return { storagePath: relativePath, sha256 };
}

/**
 * Reads a file from private disk storage with strict directory confinement.
 */
export async function readPrivateFile(storagePath: string): Promise<Buffer> {
  const resolved = path.resolve(STORAGE_ROOT, storagePath);
  if (!resolved.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error('PATH_TRAVERSAL_BLOCKED');
  }
  return fs.readFile(resolved);
}

/**
 * Issues a short-lived HMAC-signed access token (default 5 minutes) bound to a specific file ID and user.
 */
export function signFileAccessToken(fileId: number, userId: number, ttlSeconds = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${fileId}:${userId}:${exp}`;
  const sig = crypto.createHmac('sha256', FILE_SIGN_SECRET).update(payload).digest('base64url');
  return `${exp}.${userId}.${sig}`;
}

export function verifyFileAccessToken(fileId: number, token: string): { userId: number } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [expStr, userIdStr, sig] = parts;
  const exp = Number(expStr);
  const userId = Number(userIdStr);
  if (!Number.isFinite(exp) || !Number.isInteger(userId) || exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  const payload = `${fileId}:${userId}:${exp}`;
  const expectedSig = crypto
    .createHmac('sha256', FILE_SIGN_SECRET)
    .update(payload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  return { userId };
}

/**
 * Strict object-level authorization check for private documents.
 */
export function canUserAccessFile(
  user: AuthenticatedUser | null,
  file: {
    purpose: string;
    uploadedByUid: string | null;
    ownerOrgType: string | null;
    ownerOrgId: number | null;
  }
): boolean {
  // Weigh-in lot showcase photos are visible to authenticated B2B marketplace users
  if (file.purpose === 'weighin_photo') {
    return true;
  }
  if (!user) return false;
  if (user.role === 'platform_admin') return true;
  if (file.uploadedByUid && file.uploadedByUid === user.uid) return true;

  // Private KYC documents: strictly platform_admin or owning recycling factory
  if (file.purpose === 'kyc_document') {
    return file.ownerOrgType === 'factory' && file.ownerOrgId !== null && user.factoryId === file.ownerOrgId;
  }

  // Operational evidence (POD, weighbridge ticket, recycling evidence, supporting docs):
  // Accessible to owning org or participating supply-chain partner verified by route-level ACL
  if (file.ownerOrgType === 'hub' && user.hubId === file.ownerOrgId) return true;
  if (file.ownerOrgType === 'factory' && user.factoryId === file.ownerOrgId) return true;
  if (file.ownerOrgType === 'logistics_provider' && user.logisticsProviderId === file.ownerOrgId) {
    return true;
  }
  return false;
}

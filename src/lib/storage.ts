import type { AuthenticatedUser } from '../middleware/auth.ts';
import {
  ALLOWED_MIME_TYPES,
  VALID_FILE_PURPOSES,
  validateFileMagicBytes,
  signFileAccessToken,
  verifyFileAccessToken,
  getStorageProvider,
  type SignedUrlParams,
  type SignedUrlResult,
  type StorageHealthResult,
  type StorageObjectMetadata,
} from '../infra/storage/index.ts';

export {
  ALLOWED_MIME_TYPES,
  VALID_FILE_PURPOSES,
  validateFileMagicBytes,
  signFileAccessToken,
  verifyFileAccessToken,
  getStorageProvider,
};

/**
 * Stores a validated file buffer via the configured ObjectStorageProvider (local, S3-compatible, or GCS)
 * and returns its provider-independent storage key + SHA-256 digest.
 */
export async function storePrivateFile(
  buffer: Buffer,
  purpose: string,
  mimeType: string,
  originalName?: string
): Promise<{ storagePath: string; sha256: string; provider: string }> {
  const provider = getStorageProvider();
  const meta = await provider.upload({
    buffer,
    purpose,
    mimeType,
    originalName,
  });
  return {
    storagePath: meta.key,
    sha256: meta.sha256,
    provider: meta.provider,
  };
}

/**
 * Reads a file from the configured ObjectStorageProvider.
 */
export async function readPrivateFile(storagePath: string): Promise<Buffer> {
  return getStorageProvider().download(storagePath);
}

/**
 * Deletes a file from the configured ObjectStorageProvider.
 */
export async function deletePrivateFile(storagePath: string): Promise<boolean> {
  return getStorageProvider().delete(storagePath);
}

/**
 * Retrieves object metadata from the configured ObjectStorageProvider.
 */
export async function getPrivateFileMetadata(storagePath: string): Promise<StorageObjectMetadata | null> {
  return getStorageProvider().getMetadata(storagePath);
}

/**
 * Generates a short-lived signed download URL (app-proxy HMAC or direct S3/GCS presigned URL depending on configuration).
 */
export async function getSignedFileDownloadUrl(params: SignedUrlParams): Promise<SignedUrlResult> {
  return getStorageProvider().getSignedDownloadUrl(params);
}

/**
 * Checks configured object storage provider health.
 */
export async function getStorageHealth(): Promise<StorageHealthResult> {
  return getStorageProvider().healthCheck();
}

/**
 * Strict object-level authorization check for private documents.
 * Preserved identically across local, S3-compatible, and GCS providers.
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
  if (!user) return false;
  // Weigh-in lot showcase photos are visible to authenticated B2B marketplace users
  if (file.purpose === 'weighin_photo') {
    return true;
  }
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


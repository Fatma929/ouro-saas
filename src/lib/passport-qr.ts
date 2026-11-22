/**
 * Utilities for encoding and decoding Ouro Digital Waste Passport QR codes.
 * Every minted passport produces a unique, scannable deep-link URL containing
 * the immutable Passport ID (`OURO-PAS-YYYY-XXXXXX`), verifiable both by native
 * mobile cameras and by the in-app Field Worker / 3PL Driver QR scanner.
 */

const PASSPORT_CODE_REGEX = /OURO-PAS-\d{4}-[A-Z0-9]{4,10}/i;

/**
 * Builds the canonical scannable URL payload for a Digital Waste Passport QR code.
 * Uses the active deployment origin when running in the browser so native phone
 * cameras navigate directly to the live OURO Passport verifier.
 */
export function buildPassportQrUrl(passportCode: string): string {
  const cleanCode = passportCode.trim().toUpperCase();
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://ouro.eco';
  return `${origin}/?passport=${encodeURIComponent(cleanCode)}`;
}

/**
 * Extracts a canonical `OURO-PAS-YYYY-XXXXXX` Passport code from any scanned QR
 * payload (full deep-link URL, query string, JSON payload, or raw code).
 */
export function extractPassportCodeFromScan(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  // 1. Direct regex match anywhere in the payload (handles URLs, JSON, raw codes)
  const directMatch = trimmed.match(PASSPORT_CODE_REGEX);
  if (directMatch) {
    return directMatch[0].toUpperCase();
  }

  // 2. Fallback: attempt URL query parameter extraction (?passport=...)
  try {
    const parsed = new URL(trimmed);
    const param = parsed.searchParams.get('passport');
    if (param && param.trim()) {
      return param.trim().toUpperCase();
    }
  } catch {
    // Not a valid URL — fall through
  }

  // 3. Fallback: accept raw uppercase alphanumeric codes entered manually
  if (/^[A-Z0-9-]{6,32}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return null;
}

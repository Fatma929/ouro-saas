import crypto from 'crypto';
import { promisify } from 'util';
import { getCacheProvider } from '../infra/cache/index.ts';

const scryptAsync = promisify(crypto.scrypt);

// Session signing key read from server env with secure in-memory ephemeral fallback (never hardcoded)
const SESSION_SECRET =
  process.env.OURO_SESSION_SECRET && process.env.OURO_SESSION_SECRET.length >= 16
    ? process.env.OURO_SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

const REVOKED_TOKEN_PREFIX = 'auth:revoked:';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export async function verifyPasswordAsync(
  password: string,
  storedHash: string | null | undefined
): Promise<boolean> {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export interface SessionPayload {
  jti?: string;
  uid: string;
  userId: number;
  email: string;
  role: string;
  exp: number;
}

export function signSessionToken(
  payload: Omit<SessionPayload, 'exp' | 'jti'>,
  ttlSeconds = 60 * 60 * 12
): string {
  const full: SessionPayload = {
    jti: crypto.randomBytes(16).toString('hex'),
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `ouro.${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token.startsWith('ouro.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Revokes a signed OURO session token in the shared CacheProvider (Memory in dev, Redis in multi-instance prod)
 * until its natural expiration timestamp.
 */
export async function revokeSessionToken(token: string): Promise<boolean> {
  const payload = verifySessionToken(token);
  if (!payload) return false;
  const remainingSec = Math.max(60, payload.exp - Math.floor(Date.now() / 1000));
  const tokenKey = payload.jti || crypto.createHash('sha256').update(token).digest('hex');
  await getCacheProvider().set(`${REVOKED_TOKEN_PREFIX}${tokenKey}`, '1', remainingSec);
  return true;
}

export async function isSessionTokenRevoked(token: string, payload?: SessionPayload | null): Promise<boolean> {
  const resolved = payload ?? verifySessionToken(token);
  if (!resolved) return true;
  const tokenKey = resolved.jti || crypto.createHash('sha256').update(token).digest('hex');
  const marker = await getCacheProvider().get(`${REVOKED_TOKEN_PREFIX}${tokenKey}`);
  return marker !== null;
}

export function generatePassportCode(): string {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `OURO-PAS-${year}-${suffix}`;
}

export function generateReservationCode(): string {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `OURO-RES-${year}-${suffix}`;
}

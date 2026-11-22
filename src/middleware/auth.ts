import { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { verifySessionToken } from '../lib/auth-utils.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';
import type { UserRole } from '../shared/constants.ts';

export interface AuthenticatedUser {
  id: number;
  uid: string;
  email: string;
  fullName: string;
  phone: string | null;
  accountCode: string | null;
  role: UserRole;
  hubId: number | null;
  factoryId: number | null;
  logisticsProviderId: number | null;
  language: string;
}

export interface AuthRequest extends Request {
  authUser?: AuthenticatedUser;
}

const OWNER_ADMIN_EMAIL = (
  process.env.OURO_BOOTSTRAP_ADMIN_EMAIL || 'fatmaelzahraalegal@gmail.com'
)
  .trim()
  .toLowerCase();

async function syncFirebaseUser(uid: string, email: string, name?: string) {
  // Check by uid first, then by email
  const byUid = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
  if (byUid.length > 0) {
    return byUid[0];
  }
  const byEmail = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (byEmail.length > 0) {
    const updated = await db
      .update(users)
      .set({ uid })
      .where(eq(users.id, byEmail[0].id))
      .returning();
    return updated[0];
  }

  const defaultRole: UserRole =
    email.toLowerCase() === OWNER_ADMIN_EMAIL ? 'platform_admin' : 'generator_ops';

  const inserted = await db
    .insert(users)
    .values({
      uid,
      email: email.toLowerCase(),
      fullName: name || email.split('@')[0],
      role: defaultRole,
      language: 'en',
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: { email: email.toLowerCase() },
    })
    .returning();

  return inserted[0];
}

export async function resolveUserFromBearer(authHeader?: string): Promise<AuthenticatedUser | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  if (token.startsWith('ouro.')) {
    const payload = verifySessionToken(token);
    if (!payload) return null;
    const rows = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
    if (rows.length === 0) return null;
    const u = rows[0];
    if (!u.isActive) {
      throw Object.assign(new Error('Account has been deactivated by platform administration.'), {
        statusCode: 403,
      });
    }
    return {
      id: u.id,
      uid: u.uid,
      email: u.email,
      fullName: u.fullName,
      phone: u.phone,
      accountCode: u.accountCode,
      role: u.role as UserRole,
      hubId: u.hubId,
      factoryId: u.factoryId,
      logisticsProviderId: u.logisticsProviderId,
      language: u.language,
    };
  }

  const decoded = await adminAuth.verifyIdToken(token);
  const email = (decoded.email || `${decoded.uid}@ouro.eco`).toLowerCase();
  const u = await syncFirebaseUser(decoded.uid, email, decoded.name);
  if (!u.isActive) {
    throw Object.assign(new Error('Account has been deactivated by platform administration.'), {
      statusCode: 403,
    });
  }
  return {
    id: u.id,
    uid: u.uid,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    accountCode: u.accountCode,
    role: u.role as UserRole,
    hubId: u.hubId,
    factoryId: u.factoryId,
    logisticsProviderId: u.logisticsProviderId,
    language: u.language,
  };
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing authentication token' });
  }

  try {
    const user = await resolveUserFromBearer(authHeader);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
    }
    req.authUser = user;
    return next();
  } catch (error: any) {
    if (error?.statusCode === 403) {
      return res.status(403).json({ error: error.message });
    }
    console.error('Authentication verification failed:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      return res.status(403).json({
        error: `Forbidden: This action requires role [${allowedRoles.join(' | ')}]`,
      });
    }
    return next();
  };
};

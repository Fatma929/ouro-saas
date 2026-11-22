import { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { isSessionTokenRevoked, verifySessionToken } from '../lib/auth-utils.ts';
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

function getBootstrapAdminEmail(): string | null {
  const explicit = process.env.OURO_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (explicit && explicit.includes('@')) return explicit;
  // In production, never auto-promote a hardcoded fallback email; require explicit OURO_BOOTSTRAP_ADMIN_EMAIL
  if (process.env.NODE_ENV === 'production') return null;
  return 'fatmaelzahraalegal@gmail.com';
}

export interface FirebaseIdentityInput {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/**
 * Pure security guard for Firebase email-to-account linking & bootstrap admin promotion.
 * Exported for unit testing and invoked inside syncFirebaseUser.
 */
export function evaluateFirebaseLinkPolicy(params: {
  incoming: FirebaseIdentityInput;
  existingByEmail: { uid: string; email: string } | null;
  bootstrapAdminEmail: string | null;
}): { allowed: true; canLinkExisting: boolean; grantBootstrapAdmin: boolean } | { allowed: false; reason: string } {
  const { incoming, existingByEmail, bootstrapAdminEmail } = params;
  const cleanEmail = incoming.email.trim().toLowerCase();

  if (existingByEmail) {
    if (!incoming.emailVerified) {
      return {
        allowed: false,
        reason: 'Email address must be verified before linking an existing OURO account.',
      };
    }
    // Never overwrite an already-bound external Firebase UID (only local ouro-* seed/credential UIDs may be linked once)
    const isLocalPlaceholderUid = existingByEmail.uid.startsWith('ouro-');
    if (!isLocalPlaceholderUid && existingByEmail.uid !== incoming.uid) {
      return {
        allowed: false,
        reason: 'This email is already bound to a different verified identity provider account.',
      };
    }
    return { allowed: true, canLinkExisting: true, grantBootstrapAdmin: false };
  }

  const grantBootstrapAdmin = Boolean(
    incoming.emailVerified && bootstrapAdminEmail && cleanEmail === bootstrapAdminEmail
  );
  return { allowed: true, canLinkExisting: false, grantBootstrapAdmin };
}

async function syncFirebaseUser(identity: FirebaseIdentityInput) {
  const cleanEmail = identity.email.trim().toLowerCase();

  // Check by uid first
  const byUid = await db.select().from(users).where(eq(users.uid, identity.uid)).limit(1);
  if (byUid.length > 0) {
    return byUid[0];
  }

  const byEmail = await db.select().from(users).where(eq(users.email, cleanEmail)).limit(1);
  const policy = evaluateFirebaseLinkPolicy({
    incoming: identity,
    existingByEmail: byEmail.length > 0 ? { uid: byEmail[0].uid, email: byEmail[0].email } : null,
    bootstrapAdminEmail: getBootstrapAdminEmail(),
  });

  if (!policy.allowed) {
    throw Object.assign(new Error(policy.reason), { statusCode: 403 });
  }

  if (byEmail.length > 0 && policy.canLinkExisting) {
    const updated = await db
      .update(users)
      .set({ uid: identity.uid })
      .where(eq(users.id, byEmail[0].id))
      .returning();
    return updated[0];
  }

  const defaultRole: UserRole = policy.grantBootstrapAdmin ? 'platform_admin' : 'generator_ops';

  const inserted = await db
    .insert(users)
    .values({
      uid: identity.uid,
      email: cleanEmail,
      fullName: identity.name || cleanEmail.split('@')[0],
      role: defaultRole,
      language: 'en',
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: { email: cleanEmail },
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
    if (await isSessionTokenRevoked(token, payload)) {
      return null;
    }
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

  const decoded = await adminAuth.verifyIdToken(token, true);
  const email = (decoded.email || `${decoded.uid}@ouro.eco`).toLowerCase();
  const u = await syncFirebaseUser({
    uid: decoded.uid,
    email,
    emailVerified: Boolean(decoded.email_verified),
    name: decoded.name,
  });
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

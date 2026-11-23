import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import {
  signSessionToken,
  verifySessionToken,
  revokeSessionToken,
  isSessionTokenRevoked,
  hashPasswordAsync,
  verifyPasswordAsync,
} from '../src/lib/auth-utils.ts';
import { evaluateFirebaseLinkPolicy } from '../src/middleware/auth.ts';
import { createCorsMiddleware, sanitizeCsvCell } from '../src/middleware/security.ts';
import { validateEnvironmentConfig } from '../src/infra/config.ts';
import { validateFileMagicBytes, canUserAccessFile, ALLOWED_MIME_TYPES } from '../src/lib/storage.ts';
import { resetCacheProviderForTests } from '../src/infra/cache/index.ts';

function mockReqRes(opts: {
  method?: string;
  origin?: string;
  host?: string;
  forwardedHost?: string;
}) {
  const headers: Record<string, string> = {};
  if (opts.origin) headers.origin = opts.origin;
  if (opts.host) headers.host = opts.host;
  if (opts.forwardedHost) headers['x-forwarded-host'] = opts.forwardedHost;

  const outHeaders: Record<string, string> = {};
  let statusCode = 200;
  let jsonBody: unknown = undefined;
  let ended = false;
  let nextCalled = false;

  const req = {
    method: opts.method || 'GET',
    headers,
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;

  const res = {
    setHeader(k: string, v: string) {
      outHeaders[k.toLowerCase()] = v;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      jsonBody = body;
      ended = true;
      return res;
    },
    end() {
      ended = true;
      return res;
    },
  } as unknown as Response;

  const next: NextFunction = () => {
    nextCalled = true;
  };

  return {
    req,
    res,
    next,
    getState: () => ({ statusCode, jsonBody, ended, nextCalled, outHeaders }),
  };
}

describe('Phase 3 — Authentication, Revocation & Firebase Account Linking', () => {
  beforeEach(async () => {
    await resetCacheProviderForTests();
  });

  it('hashes and verifies passwords asynchronously with salted scrypt', async () => {
    const hashA = await hashPasswordAsync('OuroSecure#2026');
    const hashB = await hashPasswordAsync('OuroSecure#2026');
    expect(hashA).not.toEqual(hashB);
    expect(await verifyPasswordAsync('OuroSecure#2026', hashA)).toBe(true);
    expect(await verifyPasswordAsync('WrongPassword!', hashA)).toBe(false);
    expect(await verifyPasswordAsync('OuroSecure#2026', 'malformed-hash')).toBe(false);
  });

  it('signs, verifies, rejects tampered tokens, and immediately revokes logged-out sessions via jti', async () => {
    const token = signSessionToken({
      userId: 42,
      uid: 'ouro-user-42',
      email: 'ops@example.eg',
      role: 'generator_ops',
    });

    const verified = verifySessionToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(42);
    expect(verified?.jti).toBeTruthy();

    // Tampered payload or signature must fail verification
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -4)}AAAA`;
    expect(verifySessionToken(tampered)).toBeNull();
    expect(verifySessionToken('invalid.token')).toBeNull();

    // Not revoked initially
    expect(await isSessionTokenRevoked(token, verified!)).toBe(false);

    // Revoke on logout -> immediately rejected
    const revoked = await revokeSessionToken(token);
    expect(revoked).toBe(true);
    expect(await isSessionTokenRevoked(token, verified!)).toBe(true);
  });

  it('blocks unverified Firebase emails from linking existing accounts or claiming bootstrap admin', () => {
    const unverifiedLink = evaluateFirebaseLinkPolicy({
      incoming: {
        uid: 'firebase-attacker-1',
        email: 'ops@smartvillage.eg',
        emailVerified: false,
      },
      existingByEmail: { uid: 'ouro-seed-gen-1', email: 'ops@smartvillage.eg' },
      bootstrapAdminEmail: 'admin@ouro.eco',
    });
    expect(unverifiedLink.allowed).toBe(false);

    const unverifiedAdmin = evaluateFirebaseLinkPolicy({
      incoming: {
        uid: 'firebase-attacker-2',
        email: 'admin@ouro.eco',
        emailVerified: false,
      },
      existingByEmail: null,
      bootstrapAdminEmail: 'admin@ouro.eco',
    });
    expect(unverifiedAdmin.allowed).toBe(true);
    if (unverifiedAdmin.allowed) {
      expect(unverifiedAdmin.grantBootstrapAdmin).toBe(false);
    }
  });

  it('prevents cross-provider UID hijacking when email is already bound to a Firebase UID', () => {
    const hijackAttempt = evaluateFirebaseLinkPolicy({
      incoming: {
        uid: 'firebase-new-uid',
        email: 'verified@company.eg',
        emailVerified: true,
      },
      existingByEmail: { uid: 'firebase-original-uid', email: 'verified@company.eg' },
      bootstrapAdminEmail: null,
    });
    expect(hijackAttempt.allowed).toBe(false);

    // Legitimate first-time link of a local ouro-* account with verified email succeeds
    const validLink = evaluateFirebaseLinkPolicy({
      incoming: {
        uid: 'firebase-verified-uid',
        email: 'ops@smartvillage.eg',
        emailVerified: true,
      },
      existingByEmail: { uid: 'ouro-seed-gen-1', email: 'ops@smartvillage.eg' },
      bootstrapAdminEmail: null,
    });
    expect(validLink).toEqual({
      allowed: true,
      canLinkExisting: true,
      grantBootstrapAdmin: false,
    });
  });
});

describe('Phase 3 — CORS, Environment Validation, File ACLs & Sanitization', () => {
  it('enforces explicit CORS allowlist and rejects disallowed cross-origin writes & preflights', () => {
    const mw = createCorsMiddleware(['https://app.ouro.example']);

    // Allowed explicit origin
    const ok = mockReqRes({ method: 'POST', origin: 'https://app.ouro.example', host: 'api.ouro.example' });
    mw(ok.req, ok.res, ok.next);
    expect(ok.getState().nextCalled).toBe(true);
    expect(ok.getState().outHeaders['access-control-allow-origin']).toBe('https://app.ouro.example');
    expect(ok.getState().outHeaders['vary']).toBe('Origin');

    // Same-origin request allowed without explicit ALLOWED_ORIGINS entry
    const sameOrigin = mockReqRes({ method: 'POST', origin: 'http://localhost:3000', host: 'localhost:3000' });
    mw(sameOrigin.req, sameOrigin.res, sameOrigin.next);
    expect(sameOrigin.getState().nextCalled).toBe(true);

    // Disallowed cross-origin preflight -> 403
    const badPreflight = mockReqRes({ method: 'OPTIONS', origin: 'https://evil.attacker', host: 'api.ouro.example' });
    mw(badPreflight.req, badPreflight.res, badPreflight.next);
    expect(badPreflight.getState().statusCode).toBe(403);
    expect(badPreflight.getState().nextCalled).toBe(false);

    // Disallowed cross-origin state-changing POST -> 403
    const badPost = mockReqRes({ method: 'POST', origin: 'https://evil.attacker', host: 'api.ouro.example' });
    mw(badPost.req, badPost.res, badPost.next);
    expect(badPost.getState().statusCode).toBe(403);
    expect(badPost.getState().nextCalled).toBe(false);
  });

  it('fails fast in production when signing secrets are short/missing or DB is unconfigured', () => {
    expect(() =>
      validateEnvironmentConfig(
        {
          NODE_ENV: 'production',
          DEPLOYMENT_TOPOLOGY: 'single-instance',
          ALLOW_IN_MEMORY_CACHE_IN_PROD: 'true',
          DATABASE_URL: 'postgres://user:pass@db.internal:5432/ouro',
          OURO_SESSION_SECRET: 'too-short',
          OURO_FILE_SIGN_SECRET: 'too-short',
        },
        { throwOnProductionError: true }
      )
    ).toThrow(/Production environment validation failed/);

    const validProd = validateEnvironmentConfig(
      {
        NODE_ENV: 'production',
        DEPLOYMENT_TOPOLOGY: 'multi-instance',
        CACHE_PROVIDER: 'redis',
        REDIS_URL: 'rediss://default:pass@redis.internal:6379',
        DATABASE_URL: 'postgres://user:pass@db.internal:5432/ouro',
        DB_SSL: 'require',
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'ouro-prod-private',
        OURO_SESSION_SECRET: 'a'.repeat(40),
        OURO_FILE_SIGN_SECRET: 'b'.repeat(40),
      },
      { throwOnProductionError: true }
    );
    expect(validProd.valid).toBe(true);
    expect(validProd.errors).toHaveLength(0);
  });

  it('rejects MIME-spoofed uploads and requires authentication for weighin_photo ACLs', () => {
    const htmlAsPng = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
    expect(validateFileMagicBytes(htmlAsPng, 'image/png')).toBe(false);

    const validPdf = Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8');
    expect(validateFileMagicBytes(validPdf, 'application/pdf')).toBe(true);
    expect(ALLOWED_MIME_TYPES.has('image/svg+xml')).toBe(false);

    const weighinFile = {
      purpose: 'weighin_photo',
      uploadedByUid: 'ouro-seed-gen-1',
      ownerOrgType: 'hub',
      ownerOrgId: 1,
    };

    // Unauthenticated user cannot access weighin_photo
    expect(canUserAccessFile(null, weighinFile)).toBe(false);

    // Authenticated user can view weighin_photo
    expect(
      canUserAccessFile(
        {
          id: 2,
          uid: 'ouro-factory-1',
          email: 'buyer@factory.eg',
          fullName: 'Factory Buyer',
          phone: null,
          accountCode: null,
          role: 'factory_procurement',
          hubId: null,
          factoryId: 1,
          logisticsProviderId: null,
          language: 'en',
        },
        weighinFile
      )
    ).toBe(true);
  });

  it('neutralizes spreadsheet formula injection in CSV cells', () => {
    expect(sanitizeCsvCell('=CMD("calc")')).toBe('"\'=CMD(""calc"")"');
    expect(sanitizeCsvCell('+SUM(A1:A2)')).toBe('"\'+SUM(A1:A2)"');
    expect(sanitizeCsvCell('-2+3')).toBe('"\'-2+3"');
    expect(sanitizeCsvCell('@HYPERLINK("http://evil")')).toBe('"\'@HYPERLINK(""http://evil"")"');
    expect(sanitizeCsvCell('Safe Text')).toBe('"Safe Text"');
  });

  it('maintains a valid Drizzle baseline migration matching all 14 tables and 23 foreign keys', () => {
    const migrationPath = path.resolve(process.cwd(), 'drizzle/0000_baseline_ouro_schema.sql');
    const journalPath = path.resolve(process.cwd(), 'drizzle/meta/_journal.json');
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(fs.existsSync(journalPath)).toBe(true);

    const sqlText = fs.readFileSync(migrationPath, 'utf8');
    const tables = sqlText.match(/^CREATE TABLE /gm) || [];
    const fks = sqlText.match(/ADD CONSTRAINT .* FOREIGN KEY/g) || [];
    const indexes = sqlText.match(/^CREATE INDEX /gm) || [];

    expect(tables.length).toBe(14);
    expect(fks.length).toBe(23);
    expect(indexes.length).toBe(17);
  });
});

describe('Phase 3 Final — Live Security Test Safety Guard & Database Reliability', () => {
  it('defaults live security tests to local and unconditionally refuses production environments or URLs', async () => {
    const { assertSafeSecurityTestTarget, SecurityTestSafetyError } = await import(
      '../src/lib/test-safety.ts'
    );

    // Default local target succeeds
    const localDefault = assertSafeSecurityTestTarget({});
    expect(localDefault.targetClass).toBe('local');
    expect(localDefault.baseUrl).toBe('http://127.0.0.1:3000');

    // NODE_ENV=production refused even against localhost
    expect(() =>
      assertSafeSecurityTestTarget({ NODE_ENV: 'production', QA_BASE_URL: 'http://127.0.0.1:3000' })
    ).toThrow(SecurityTestSafetyError);

    // Production hostname refused EVEN IF staging opt-in flags are both forced true
    expect(() =>
      assertSafeSecurityTestTarget({
        NODE_ENV: 'development',
        OURO_SECURITY_TEST_MODE: 'staging',
        OURO_ALLOW_SHARED_STAGING_TESTS: 'true',
        QA_BASE_URL: 'https://app.ouro-circular.com',
      })
    ).toThrow(/unconditionally forbidden against production/i);

    expect(() =>
      assertSafeSecurityTestTarget({
        NODE_ENV: 'development',
        OURO_SECURITY_TEST_MODE: 'staging',
        OURO_ALLOW_SHARED_STAGING_TESTS: 'true',
        QA_BASE_URL: 'https://prod.ouro.example',
      })
    ).toThrow(SecurityTestSafetyError);

    // Non-local staging target refused without BOTH opt-in variables
    expect(() =>
      assertSafeSecurityTestTarget({
        NODE_ENV: 'development',
        QA_BASE_URL: 'https://staging.ouro-circular.example',
      })
    ).toThrow(/OURO_ALLOW_SHARED_STAGING_TESTS=true/i);

    // Non-local staging target allowed ONLY with explicit dual opt-in
    const stagingOk = assertSafeSecurityTestTarget({
      NODE_ENV: 'development',
      OURO_SECURITY_TEST_MODE: 'staging',
      OURO_ALLOW_SHARED_STAGING_TESTS: 'true',
      QA_BASE_URL: 'https://staging.ouro-circular.example',
    });
    expect(stagingOk.targetClass).toBe('staging');
    expect(stagingOk.baseUrl).toBe('https://staging.ouro-circular.example');
  });

  it('validates database pool limits, produces actionable credential-redacted errors, and closes pools cleanly', async () => {
    const {
      buildPostgresPoolConfig,
      formatActionableDatabaseError,
      createDatabaseProvider,
    } = await import('../src/infra/database.ts');
    const { InfraConfigurationError } = await import('../src/infra/config.ts');

    // Missing DB target rejected explicitly
    expect(() =>
      buildPostgresPoolConfig({
        port: 5432,
        sslMode: 'disable',
        poolMax: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000,
      })
    ).toThrow(InfraConfigurationError);

    // Out-of-range poolMax rejected explicitly
    expect(() =>
      buildPostgresPoolConfig({
        host: '127.0.0.1',
        port: 5432,
        sslMode: 'disable',
        poolMax: 0,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000,
      })
    ).toThrow(/DB_POOL_MAX/);

    // Actionable errors redact secrets and explain operator recovery steps
    const refused = formatActionableDatabaseError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' });
    expect(refused.code).toBe('DB_CONNECTION_REFUSED');
    expect(refused.message).toMatch(/refused the connection/i);

    const authErr = formatActionableDatabaseError({
      code: '28P01',
      message: 'password authentication failed for postgres://admin:SuperSecret@db.internal:5432/ouro',
    });
    expect(authErr.code).toBe('DB_AUTH_FAILED');
    expect(authErr.message).not.toContain('SuperSecret');

    // Connection failure against closed port returns structured unhealthy result & closes cleanly
    const badProvider = createDatabaseProvider({
      host: '127.0.0.1',
      port: 1,
      user: 'ouro',
      password: 'pw',
      database: 'ouro',
      sslMode: 'disable',
      poolMax: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 800,
    });
    const health = await badProvider.healthCheck();
    expect(health.connected).toBe(false);
    expect(health.errorCode).toBeTruthy();
    expect(health.error).toBeTruthy();
    await badProvider.close();
    // Idempotent second close succeeds cleanly
    await badProvider.close();
  });
});

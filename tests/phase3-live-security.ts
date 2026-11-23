/**
 * OURO Phase 3 Live Security & Database Hardening Verification Suite
 *
 * SAFETY POLICY:
 *  - Defaults to local isolated target: http://127.0.0.1:3000
 *  - Unconditionally refuses to run against production environments or production-like URLs.
 *  - Requires BOTH OURO_SECURITY_TEST_MODE=staging AND OURO_ALLOW_SHARED_STAGING_TESTS=true
 *    to run against a shared staging server.
 *  - Uses isolated test accounts for profile mutations and guarantees cleanup in `finally`
 *    even if a test fails midway.
 *
 * Run locally:
 *   bun run test:security:live
 */

import 'dotenv/config';
import assert from 'node:assert/strict';
import { getDatabaseProvider } from '../src/infra/database.ts';
import { assertSafeSecurityTestTarget } from '../src/lib/test-safety.ts';

// 1. Validate environment & target URL BEFORE any network request or mutation
const safetyGuard = assertSafeSecurityTestTarget(process.env);
const BASE_URL = safetyGuard.baseUrl;

interface ApiResult {
  status: number;
  headers: Headers;
  body: any;
  text: string;
}

async function req(
  path: string,
  options: {
    method?: string;
    token?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<ApiResult> {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  let rawBody: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    rawBody = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: rawBody,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body, text };
}

async function uploadFile(
  token: string,
  purpose: string,
  fileName: string,
  mimeType: string,
  bytes: Buffer
): Promise<ApiResult> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);
  form.append('purpose', purpose);
  const res = await fetch(`${BASE_URL}/api/storage/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body, text };
}

async function login(identifier: string, password = 'OuroDemo#2026'): Promise<{ token: string; user: any }> {
  const res = await req('/api/auth/login', {
    method: 'POST',
    body: { identifier, password },
  });
  assert.equal(res.status, 200, `Login failed for ${identifier}: ${res.text}`);
  return { token: res.body.token, user: res.body.user };
}

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const VALID_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8');

// Guaranteed LIFO cleanup stack — executes in `finally` even if any assertion fails mid-suite
const cleanupStack: Array<{ label: string; run: () => Promise<void> }> = [];
function registerCleanup(label: string, run: () => Promise<void>) {
  cleanupStack.push({ label, run });
}

async function runAllCleanups() {
  if (cleanupStack.length === 0) return;
  console.log(`\n  [CLEANUP] Running ${cleanupStack.length} guaranteed cleanup action(s)...`);
  while (cleanupStack.length > 0) {
    const item = cleanupStack.pop()!;
    try {
      await item.run();
    } catch (err: any) {
      console.warn(`  [CLEANUP WARN] ${item.label}: ${err?.message || err}`);
    }
  }
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name} (${Date.now() - t0}ms)`);
  } catch (err: any) {
    console.error(`  [FAIL] ${name}: ${err?.message || err}`);
    throw err;
  }
}

async function main() {
  console.log(
    `\n=== OURO Phase 3 Live Security & Database Verification ===\n` +
      `Target: ${BASE_URL} (class=${safetyGuard.targetClass}, mode=${safetyGuard.mode})\n`
  );

  // Pre-flight check: confirm server is alive before authenticating
  const preflightHealth = await req('/api/health');
  assert.equal(
    preflightHealth.status,
    200,
    `Target server ${BASE_URL} is not reachable (/api/health returned ${preflightHealth.status}).`
  );

  try {
    const admin = await login('admin@ouro.eco');
    const gen1 = await login('ops@smartvillage.eg');
    const factory1 = await login('procurement@nilekraft.eg');
    const driver1 = await login('driver@nilegreen3pl.eg');

    // Provision a dedicated isolated test factory account so profile/cross-org tests NEVER touch real or seeded customer profiles
    const runSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const isolatedFactoryEmail = `sec-test-factory-${runSuffix}@ouro-test.invalid`;
    const isolatedFactoryPass = `SecTest#${runSuffix}!`;
    const regIsolated = await req('/api/auth/register-factory', {
      method: 'POST',
      body: {
        factoryName: `OURO Security Test Recycler ${runSuffix}`,
        factoryNameAr: `مصنع اختبار أمني ${runSuffix}`,
        industrialZone: 'Isolated Test Industrial Zone',
        governorate: 'Cairo',
        taxId: `SEC-TAX-${runSuffix}`,
        commercialRegNo: `SEC-CR-${runSuffix}`,
        contactPerson: 'OURO Security Test Factory Officer',
        phone: '+201099990000',
        email: isolatedFactoryEmail,
        password: isolatedFactoryPass,
        preferredCategories: ['plastics'],
      },
    });
    assert.equal(
      regIsolated.status,
      201,
      `Failed to provision isolated test factory account: ${regIsolated.status} ${regIsolated.text}`
    );
    const isolatedFactoryUserId: number = regIsolated.body.user.id;
    const isolatedFactory = {
      token: regIsolated.body.token as string,
      user: regIsolated.body.user,
    };

    registerCleanup(`Deactivate & remove isolated test factory user #${isolatedFactoryUserId}`, async () => {
      await req(`/api/admin/users/${isolatedFactoryUserId}`, {
        method: 'PATCH',
        token: admin.token,
        body: { isActive: false, reason: 'Automated security test account cleanup' },
      });
      await req('/api/auth/logout', { method: 'POST', token: isolatedFactory.token });
      // Remove disposable test user + test factory rows from local test DB to leave zero trace
      const pool = getDatabaseProvider().getPool();
      await pool.query('DELETE FROM notifications WHERE user_id = $1', [isolatedFactoryUserId]);
      await pool.query('DELETE FROM users WHERE id = $1', [isolatedFactoryUserId]);
      if (isolatedFactory.user?.factoryId) {
        await pool.query('DELETE FROM recycling_factories WHERE id = $1', [isolatedFactory.user.factoryId]);
      }
    });

    // 1. Security Headers, No X-Powered-By & CORS Disallowed Origin Rejection
    await test('1. Security headers (no X-Powered-By, X-Permitted-Cross-Domain-Policies) & strict CORS rejection', async () => {
      const health = await req('/api/health');
      assert.equal(health.status, 200);
      assert.equal(health.headers.get('x-powered-by'), null, 'X-Powered-By header must be disabled');
      assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(health.headers.get('x-permitted-cross-domain-policies'), 'none');
      assert.ok(health.headers.get('x-request-id'));

      // Disallowed cross-origin preflight -> 403
      const badPreflight = await req('/api/auth/me', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil-attacker.invalid' },
      });
      assert.equal(badPreflight.status, 403, `Expected 403 for disallowed preflight, got ${badPreflight.status}`);

      // Disallowed cross-origin state-changing POST -> 403
      const badCrossOriginPost = await req('/api/auth/logout', {
        method: 'POST',
        token: gen1.token,
        headers: { Origin: 'https://evil-attacker.invalid' },
      });
      assert.equal(
        badCrossOriginPost.status,
        403,
        `Expected 403 for disallowed cross-origin POST, got ${badCrossOriginPost.status}`
      );
    });

    // 2. Immediate Server-Side Session Revocation on POST /api/auth/logout
    await test('2. POST /api/auth/logout immediately revokes session token (401 on reuse)', async () => {
      const tempSession = await login(isolatedFactoryEmail, isolatedFactoryPass);
      const beforeLogout = await req('/api/auth/me', { token: tempSession.token });
      assert.equal(beforeLogout.status, 200);

      const logoutRes = await req('/api/auth/logout', { method: 'POST', token: tempSession.token });
      assert.equal(logoutRes.status, 200);
      assert.equal(logoutRes.body?.revoked, true);

      const afterLogout = await req('/api/auth/me', { token: tempSession.token });
      assert.equal(afterLogout.status, 401, `Revoked token should return 401, got ${afterLogout.status}`);
    });

    // 3. Marketplace RBAC Enforcement Across All 4 Roles
    await test('3. GET /api/marketplace/lots restricts access to factory_procurement & platform_admin only', async () => {
      const genBlocked = await req('/api/marketplace/lots', { token: gen1.token });
      assert.equal(genBlocked.status, 403);

      const driverBlocked = await req('/api/marketplace/lots', { token: driver1.token });
      assert.equal(driverBlocked.status, 403);

      const factoryAllowed = await req('/api/marketplace/lots', { token: factory1.token });
      assert.equal(factoryAllowed.status, 200);

      const adminAllowed = await req('/api/marketplace/lots', { token: admin.token });
      assert.equal(adminAllowed.status, 200);
    });

    // 4. Unauthenticated weighin_photo Scraping Blocked (401) + Signed URL Succeeds (200)
    await test('4. Unauthenticated GET /api/storage/:id blocked on weighin_photo (401); signed URL works (200)', async () => {
      const up = await uploadFile(gen1.token, 'weighin_photo', 'sec-test-lot-photo.png', 'image/png', VALID_PNG);
      assert.equal(up.status, 201, `Upload failed: ${up.text}`);
      const fileId = up.body.id;
      assert.ok(fileId, `Expected file id in upload response: ${up.text}`);
      registerCleanup(`Delete test weighin_photo #${fileId}`, async () => {
        await req(`/api/storage/${fileId}`, { method: 'DELETE', token: gen1.token });
      });

      const anonRes = await req(`/api/storage/${fileId}`);
      assert.equal(anonRes.status, 401, `Expected 401 for anonymous weighin_photo fetch, got ${anonRes.status}`);

      const signRes = await req(`/api/storage/${fileId}/sign`, { method: 'POST', token: factory1.token });
      assert.equal(signRes.status, 200, `Sign failed: ${signRes.text}`);
      assert.ok(signRes.body?.signedUrl?.includes('?sig='), `Expected signedUrl with ?sig=: ${signRes.text}`);

      const signedFetch = await req(signRes.body.signedUrl);
      assert.equal(signedFetch.status, 200);
      assert.equal(signedFetch.headers.get('x-content-type-options'), 'nosniff');
    });

    // 5. Cross-Organization Private File Attachment Hijacking Blocked (403)
    await test('5. Cross-organization file attachment hijacking blocked on POST /api/passports (403)', async () => {
      const kycUpload = await uploadFile(
        isolatedFactory.token,
        'kyc_document',
        'sec-test-kyc.pdf',
        'application/pdf',
        VALID_PDF
      );
      assert.equal(kycUpload.status, 201, `KYC upload failed: ${kycUpload.text}`);
      const kycFileId = kycUpload.body.id;
      registerCleanup(`Delete test kyc_document #${kycFileId}`, async () => {
        await req(`/api/storage/${kycFileId}`, { method: 'DELETE', token: isolatedFactory.token });
      });

      const docUpload = await uploadFile(
        isolatedFactory.token,
        'supporting_doc',
        'sec-test-other-org.pdf',
        'application/pdf',
        VALID_PDF
      );
      assert.equal(docUpload.status, 201, `Doc upload failed: ${docUpload.text}`);
      const otherOrgDocId = docUpload.body.id;
      registerCleanup(`Delete test supporting_doc #${otherOrgDocId}`, async () => {
        await req(`/api/storage/${otherOrgDocId}`, { method: 'DELETE', token: isolatedFactory.token });
      });

      const hijackKyc = await req('/api/passports', {
        method: 'POST',
        token: gen1.token,
        body: {
          materialCategory: 'plastics',
          materialSubtype: 'Security Test PET Bales',
          purityGrade: 'Grade A',
          weightKg: 2000,
          pricePerTonEgp: 18000,
          supportingDocFileId: kycFileId,
        },
      });
      assert.ok(
        hijackKyc.status === 403 || hijackKyc.status === 400,
        `Expected 403/400 on cross-org KYC attach, got ${hijackKyc.status}: ${hijackKyc.text}`
      );

      const hijackDoc = await req('/api/passports', {
        method: 'POST',
        token: gen1.token,
        body: {
          materialCategory: 'plastics',
          materialSubtype: 'Security Test PET Bales',
          purityGrade: 'Grade A',
          weightKg: 2000,
          pricePerTonEgp: 18000,
          supportingDocFileId: otherOrgDocId,
        },
      });
      assert.equal(
        hijackDoc.status,
        403,
        `Expected 403 on cross-org doc attach, got ${hijackDoc.status}: ${hijackDoc.text}`
      );
    });

    // 6. Factory Profile Cross-Tenant Overwrite Protection (using dedicated isolated test factory)
    await test('6. PATCH /api/factory/profile prevents factory_procurement from overwriting another factory', async () => {
      const f1Id = factory1.user.factoryId;
      const isolatedId = isolatedFactory.user.factoryId;
      assert.ok(f1Id && isolatedId && f1Id !== isolatedId);

      // Empty / unknown fields must return 400 (never 500)
      const emptyPatch = await req('/api/factory/profile', {
        method: 'PATCH',
        token: isolatedFactory.token,
        body: { unknownField: 'ignored' },
      });
      assert.equal(emptyPatch.status, 400);

      // Isolated test factory attempts to pass factoryId = f1Id in body; server must ignore body.factoryId and only touch isolatedId
      const patchRes = await req('/api/factory/profile', {
        method: 'PATCH',
        token: isolatedFactory.token,
        body: {
          factoryId: f1Id,
          procurementNotes: 'Isolated security test tenant verification note',
        },
      });
      assert.equal(
        patchRes.status,
        200,
        `Expected 200 updating own isolated test factory, got ${patchRes.status}: ${patchRes.text}`
      );
      assert.equal(patchRes.body.factory.id, isolatedId, 'Isolated test factory must NEVER modify Factory 1 record');
    });

    // 7. Cross-Organization Dispute Creation Blocked (403) & 3PL Strict Sequential Progression + Mandatory QR
    await test('7. Cross-org dispute blocked (403) & 3PL strict stage progression + mandatory pickup QR enforced', async () => {
      const createLot = await req('/api/passports', {
        method: 'POST',
        token: gen1.token,
        body: {
          materialCategory: 'paper_cardboard',
          materialSubtype: `Security Test OCC Cardboard ${runSuffix}`,
          purityGrade: 'Grade A',
          weightKg: 2000,
          pricePerTonEgp: 9500,
        },
      });
      assert.equal(createLot.status, 201, `Create lot failed: ${createLot.text}`);
      const lotId = createLot.body.passport.id;
      registerCleanup(`Cancel test passport #${lotId}`, async () => {
        await req(`/api/passports/${lotId}/cancel`, {
          method: 'POST',
          token: gen1.token,
          body: { reason: 'Phase 3 security test guaranteed cleanup' },
        });
      });

      const reserve = await req('/api/reservations', {
        method: 'POST',
        token: factory1.token,
        body: { passportId: lotId, quantityTons: 1, logisticsProviderId: driver1.user.logisticsProviderId },
      });
      assert.equal(reserve.status, 201, `Reserve failed: ${reserve.text}`);
      const resId = reserve.body.reservation.id;
      registerCleanup(`Cancel test reservation #${resId}`, async () => {
        await req(`/api/reservations/${resId}/cancel`, {
          method: 'POST',
          token: factory1.token,
          body: { reason: 'Phase 3 security test guaranteed cleanup' },
        });
      });

      // Isolated test factory (not a party to this reservation) attempts to open a dispute -> 403
      const crossOrgDispute = await req('/api/disputes', {
        method: 'POST',
        token: isolatedFactory.token,
        body: {
          reservationId: resId,
          category: 'weight_discrepancy',
          subject: 'Unauthorized third-party dispute',
          description: 'Unauthorized third-party dispute attempt against another organization reservation',
        },
      });
      assert.equal(
        crossOrgDispute.status,
        403,
        `Expected 403 on cross-org dispute, got ${crossOrgDispute.status}: ${crossOrgDispute.text}`
      );

      // 3PL attempts to skip directly from 'scheduled' to 'delivered' -> 409
      const skipStage = await req(`/api/reservations/${resId}/status`, {
        method: 'PATCH',
        token: driver1.token,
        body: { nextStatus: 'delivered' },
      });
      assert.equal(skipStage.status, 409, `Expected 409 on stage skip, got ${skipStage.status}: ${skipStage.text}`);

      // Advance sequentially: scheduled -> accepted -> en_route -> arrived
      for (const nextStatus of ['accepted', 'en_route', 'arrived']) {
        const stepRes = await req(`/api/reservations/${resId}/status`, {
          method: 'PATCH',
          token: driver1.token,
          body: { nextStatus },
        });
        assert.equal(stepRes.status, 200, `Step ${nextStatus} failed: ${stepRes.text}`);
      }

      // Attempt picked_up WITHOUT qrPassportCode -> 400 mandatory QR guard
      const missingQr = await req(`/api/reservations/${resId}/status`, {
        method: 'PATCH',
        token: driver1.token,
        body: { nextStatus: 'picked_up' },
      });
      assert.equal(
        missingQr.status,
        400,
        `Expected 400 when omitting qrPassportCode on picked_up, got ${missingQr.status}: ${missingQr.text}`
      );

      // Attempt picked_up with non-existent vehicleId -> 400
      const nonexistentVehicle = await req(`/api/reservations/${resId}/status`, {
        method: 'PATCH',
        token: driver1.token,
        body: {
          nextStatus: 'picked_up',
          qrPassportCode: createLot.body.passport.passportCode,
          vehicleId: 999999,
        },
      });
      assert.equal(
        nonexistentVehicle.status,
        400,
        `Expected 400 for non-existent vehicleId, got ${nonexistentVehicle.status}: ${nonexistentVehicle.text}`
      );

      // If another 3PL carrier has an active vehicle, verify cross-carrier vehicleId is rejected with 403
      const allVehicles = await req('/api/driver/vehicles', { token: admin.token });
      const otherCarrierVehicle = (allVehicles.body?.vehicles || []).find(
        (v: any) => v.isActive && v.logisticsProviderId !== driver1.user.logisticsProviderId
      );
      if (otherCarrierVehicle) {
        const crossCarrierVehicle = await req(`/api/reservations/${resId}/status`, {
          method: 'PATCH',
          token: driver1.token,
          body: {
            nextStatus: 'picked_up',
            qrPassportCode: createLot.body.passport.passportCode,
            vehicleId: otherCarrierVehicle.id,
          },
        });
        assert.equal(
          crossCarrierVehicle.status,
          403,
          `Expected 403 for cross-carrier vehicleId, got ${crossCarrierVehicle.status}: ${crossCarrierVehicle.text}`
        );
      }
    });

    // 8. Live PostgreSQL Schema Integrity (14 Tables, 23 FKs, 42 Indexes & Pool Health)
    await test('8. Live PostgreSQL schema integrity (14 tables, 23 FKs, 42 indexes, pool health)', async () => {
      const ready = await req('/api/ready');
      assert.equal(ready.status, 200);
      assert.equal(ready.body?.ready, true);
      assert.equal(ready.body?.database, true);

      const dbProvider = getDatabaseProvider();
      const health = await dbProvider.healthCheck();
      assert.equal(health.connected, true);

      const pool = dbProvider.getPool();
      const tablesRes = await pool.query(
        `SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_schema = 'public'`
      );
      const fksRes = await pool.query(`SELECT count(*)::int AS cnt FROM pg_constraint WHERE contype = 'f'`);
      const idxRes = await pool.query(`SELECT count(*)::int AS cnt FROM pg_indexes WHERE schemaname = 'public'`);

      assert.equal(tablesRes.rows[0].cnt, 14, `Expected 14 public tables, found ${tablesRes.rows[0].cnt}`);
      assert.equal(fksRes.rows[0].cnt, 23, `Expected 23 foreign keys, found ${fksRes.rows[0].cnt}`);
      assert.ok(idxRes.rows[0].cnt >= 42, `Expected >= 42 indexes, found ${idxRes.rows[0].cnt}`);
    });

    console.log(`\n✅ ALL ${passed}/8 PHASE 3 LIVE SECURITY & DATABASE CHECKS PASSED!\n`);
  } finally {
    await runAllCleanups();
    await getDatabaseProvider().close();
  }
}

main().catch((err) => {
  console.error('\n❌ Phase 3 live security verification failed:', err);
  process.exit(1);
});

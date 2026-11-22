/**
 * OURO End-to-End Automated QA Verification Suite
 * Exercises live Express API + Cloud SQL PostgreSQL + Private Storage + Hash Chain + ESG Engine.
 * Run: npx tsx tests/qa-suite.ts
 */

import assert from 'node:assert/strict';
import { calculateVerifiedRecyclingImpact, DEFAULT_EMISSION_FACTORS } from '../src/lib/esg-engine.ts';

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:3000';

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
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
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
  assert.ok(res.body?.token, `Missing token for ${identifier}`);
  return { token: res.body.token, user: res.body.user };
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

// Valid minimal PDF payload (passes real magic-byte %PDF- check)
const SAMPLE_PDF_BASE64 = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8').toString('base64');
// Valid 1x1 PNG payload (passes real magic-byte 89 50 4E 47 check)
const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// Spoofed PDF payload (plain HTML disguised as application/pdf — must be rejected by magic-byte check!)
const SPOOFED_PDF_BASE64 = Buffer.from('<script>alert(1)</script>', 'utf8').toString('base64');

async function main() {
  console.log(`\n=== OURO Production QA Suite against ${BASE_URL} ===\n`);

  // Ensure server is awake and seeded
  const healthPing = await req('/api/health');
  assert.equal(healthPing.status, 200, `Health endpoint failed: ${healthPing.text}`);

  const admin = await login('admin@ouro.eco');
  const generator = await login('ops@smartvillage.eg');
  const factoryApproved = await login('procurement@nilekraft.eg');
  const factoryPending = await login('kyc-pending@deltapolymer.eg');
  const driver3pl = await login('driver@nilegreen3pl.eg');

  // 1. Auth, RBAC, Security Headers & Deactivation Enforcement
  await test('1. Auth, RBAC isolation, security headers & deactivated-user blocking', async () => {
    // Verify iframe-safe security headers exist
    assert.equal(healthPing.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(healthPing.headers.get('referrer-policy'));

    // Generator cannot access admin overview (403)
    const forbiddenAdmin = await req('/api/admin/overview', { token: generator.token });
    assert.equal(forbiddenAdmin.status, 403);

    // Pending KYC factory cannot reserve material (403)
    const lotsRes = await req('/api/marketplace/lots', { token: factoryApproved.token });
    assert.equal(lotsRes.status, 200);
    const anyLot = lotsRes.body.lots[0];
    assert.ok(anyLot, 'Expected at least 1 marketplace lot');

    const kycBlocked = await req('/api/reservations', {
      method: 'POST',
      token: factoryPending.token,
      body: { passportId: anyLot.id, quantityTons: 1 },
    });
    assert.equal(kycBlocked.status, 403);
    assert.match(kycBlocked.body?.error || '', /KYC/i);

    // Admin deactivates pending factory user -> token is immediately rejected (401/403) -> Admin reactivates
    const deactivate = await req(`/api/admin/users/${factoryPending.user.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: { isActive: false, reason: 'QA suspension test' },
    });
    assert.equal(deactivate.status, 200);

    try {
      const blockedMe = await req('/api/auth/me', { token: factoryPending.token });
      assert.ok(
        blockedMe.status === 401 || blockedMe.status === 403,
        `Deactivated user should be blocked, got ${blockedMe.status}`
      );
    } finally {
      const reactivate = await req(`/api/admin/users/${factoryPending.user.id}`, {
        method: 'PATCH',
        token: admin.token,
        body: { isActive: true, reason: 'QA restore test account' },
      });
      assert.equal(reactivate.status, 200);
    }
  });

  // 2. Private Object Storage ACLs, Signed URLs & Magic-Byte Validation
  await test('2. Private storage magic-byte check, zero ?token= bypass & signed URL ACLs', async () => {
    // Reject spoofed PDF (XSS payload disguised as application/pdf)
    const spoofed = await uploadFile(
      generator.token,
      'kyc_document',
      'evil.pdf',
      'application/pdf',
      Buffer.from(SPOOFED_PDF_BASE64, 'base64')
    );
    assert.equal(spoofed.status, 400, `Spoofed PDF should fail 400, got ${spoofed.status}: ${spoofed.text}`);

    // Upload real PDF as factoryPending (KYC doc)
    const uploadOk = await uploadFile(
      factoryPending.token,
      'kyc_document',
      'QA_KYC_Test.pdf',
      'application/pdf',
      Buffer.from(SAMPLE_PDF_BASE64, 'base64')
    );
    assert.equal(uploadOk.status, 201, `Real PDF upload failed: ${uploadOk.text}`);
    const fileId = uploadOk.body.id;
    assert.ok(uploadOk.body.sha256, 'Expected SHA-256 checksum on stored file');

    // Unauthenticated & fake ?token= query param MUST fail 401
    const unauth = await req(`/api/storage/${fileId}?token=fake_bypass_attempt`);
    assert.equal(unauth.status, 401);

    // Unrelated generator user MUST fail 403 on another org's KYC file
    const crossOrg = await req(`/api/storage/${fileId}`, { token: generator.token });
    assert.equal(crossOrg.status, 403);

    // Admin signs short-lived URL and downloads successfully (200)
    const signRes = await req(`/api/storage/${fileId}/sign`, {
      method: 'POST',
      token: admin.token,
    });
    assert.equal(signRes.status, 200, `Sign failed: ${signRes.text}`);
    assert.ok(signRes.body.signedUrl);

    const downloadRes = await req(signRes.body.signedUrl);
    assert.equal(downloadRes.status, 200);
    assert.ok(downloadRes.text.startsWith('%PDF-1.4'));
  });

  // 3. Organization Isolation (Generator & 3PL)
  await test('3. Organization isolation across Waste Generators & 3PL Carriers', async () => {
    const adminOverview = await req('/api/admin/overview', { token: admin.token });
    assert.equal(adminOverview.status, 200);

    // Find a passport belonging to a DIFFERENT hub than generator.user.hubId
    const otherHubPassport = adminOverview.body.passports.find(
      (p: any) => p.hubId !== generator.user.hubId && p.status !== 'cancelled' && p.lifecycleStatus !== 'RECYCLED'
    );
    if (otherHubPassport) {
      const crossPatch = await req(`/api/passports/${otherHubPassport.id}`, {
        method: 'PATCH',
        token: generator.token,
        body: { pricePerTonEgp: 99999 },
      });
      assert.equal(crossPatch.status, 403, `Cross-org generator PATCH should be 403, got ${crossPatch.status}`);
    }

    // 3PL driver only sees jobs belonging to their own logisticsProviderId
    const driverJobs = await req('/api/driver/jobs', { token: driver3pl.token });
    assert.equal(driverJobs.status, 200);
    for (const j of driverJobs.body.jobs || []) {
      assert.equal(
        j.logisticsProviderId,
        driver3pl.user.logisticsProviderId,
        `3PL leaked job from provider ${j.logisticsProviderId}`
      );
    }
  });

  // 4. Listing Create, Edit, and Cancel Lifecycle (Unreserved Lot)
  await test('4. Waste listing create, edit, and cancel lifecycle', async () => {
    const createRes = await req('/api/passports', {
      method: 'POST',
      token: generator.token,
      body: {
        materialCategory: 'paper_cardboard',
        materialSubtype: '=CMD("qa_csv_formula_test") OCC Bales',
        purityGrade: 'Grade A',
        weightKg: 3000,
        pricePerTonEgp: 9600,
        pickupWindow: 'Mon-Thu 09:00-14:00',
        notes: 'QA temporary listing for edit/cancel + CSV sanitization verification',
      },
    });
    assert.equal(createRes.status, 201, `Create listing failed: ${createRes.text}`);
    const p = createRes.body.passport;
    assert.equal(p.lifecycleStatus, 'LISTED');
    assert.equal(p.currentStage, 3);
    assert.equal(p.verifiedCo2eTons, 0);

    // Edit price & pickup window
    const editRes = await req(`/api/passports/${p.id}`, {
      method: 'PATCH',
      token: generator.token,
      body: { pricePerTonEgp: 9900, pickupWindow: 'Daily 08:00-13:00' },
    });
    assert.equal(editRes.status, 200);
    assert.equal(editRes.body.passport.pricePerTonEgp, 9900);

    // Check generator CSV export neutralizes leading '=' formula injection!
    const csvRes = await req('/api/generator/transactions.csv', { token: generator.token });
    assert.equal(csvRes.status, 200);
    assert.ok(
      csvRes.text.includes(`"'=CMD`),
      'CSV export MUST neutralize leading = formula injection with a single quote prefix'
    );

    // Cancel unreserved lot
    const cancelRes = await req(`/api/passports/${p.id}`, {
      method: 'DELETE',
      token: generator.token,
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.passport.status, 'cancelled');
    assert.equal(cancelRes.body.passport.availableTons, 0);
  });

  // 5 & 6. Simultaneous Parallel Reservation Concurrency Race Test + Idempotency-Key + Atomic Cancellation
  let racePassportId = 0;
  let racePassportCode = '';
  let winningReservationIds: number[] = [];

  await test('5. Concurrency race test (4 parallel 2t bookings on 5t lot -> strictly 2 succeed, 2 get 409)', async () => {
    const lotRes = await req('/api/passports', {
      method: 'POST',
      token: generator.token,
      body: {
        materialCategory: 'plastics',
        materialSubtype: 'QA Clear PET Bales (Concurrency Test)',
        purityGrade: 'Grade A',
        weightKg: 5000, // 5.0 tons available
        pricePerTonEgp: 18200,
      },
    });
    assert.equal(lotRes.status, 201);
    racePassportId = lotRes.body.passport.id;
    racePassportCode = lotRes.body.passport.passportCode;

    // Fire 4 simultaneous requests for 2.0 tons each (total 8.0t > 5.0t)
    const results = await Promise.all(
      [1, 2, 3, 4].map((idx) =>
        req('/api/reservations', {
          method: 'POST',
          token: factoryApproved.token,
          headers: { 'Idempotency-Key': `qa-race-${racePassportId}-${idx}-${Date.now()}` },
          body: { passportId: racePassportId, quantityTons: 2.0 },
        })
      )
    );

    const successes = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);

    assert.equal(
      successes.length,
      2,
      `Expected strictly 2 bookings to win out of 4 on 5.0t lot, got ${successes.length} (statuses: ${results
        .map((r) => r.status)
        .join(',')})`
    );
    assert.equal(conflicts.length, 2, `Expected strictly 2 bookings to receive 409 conflict, got ${conflicts.length}`);

    winningReservationIds = successes.map((s) => s.body.reservation.id);

    // Verify exact remaining stock is 1.0t and reserved is 4.0t
    const detail = await req(`/api/passports/${racePassportCode}`, { token: generator.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.passport.availableTons, 1);
    assert.equal(detail.body.passport.reservedTons, 4);
  });

  await test('6. Idempotency-Key deduplication & atomic cancellation stock restoration', async () => {
    const idemKey = `qa-idem-${racePassportId}-${Date.now()}`;
    const first = await req('/api/reservations', {
      method: 'POST',
      token: factoryApproved.token,
      headers: { 'Idempotency-Key': idemKey },
      body: { passportId: racePassportId, quantityTons: 1.0 },
    });
    assert.equal(first.status, 201);

    // Replay exact same Idempotency-Key -> must return identical reservationCode with 0 extra stock deducted
    const replay = await req('/api/reservations', {
      method: 'POST',
      token: factoryApproved.token,
      headers: { 'Idempotency-Key': idemKey },
      body: { passportId: racePassportId, quantityTons: 1.0 },
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.body.reservation.reservationCode, first.body.reservation.reservationCode);

    // Cancel the 1.0t reservation -> must atomically restore availableTons back to 1.0t
    const cancelRes = await req(`/api/reservations/${first.body.reservation.id}/cancel`, {
      method: 'POST',
      token: factoryApproved.token,
      body: { reason: 'QA atomic stock release check' },
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.reservation.pickupStatus, 'cancelled');

    const detailAfterCancel = await req(`/api/passports/${racePassportCode}`, { token: generator.token });
    assert.equal(detailAfterCancel.body.passport.availableTons, 1);
  });

  // 7. 3PL Fleet Registration + Full Stage 6 Delivery (STRICT CHECK: DELIVERED != RECYCLED!)
  const activeResId = winningReservationIds[0];
  await test('7. 3PL vehicle registration, QR mismatch guard, & Stage 6 DELIVERED != RECYCLED invariant', async () => {
    // Register external 3PL vehicle
    const vehRes = await req('/api/driver/vehicles', {
      method: 'POST',
      token: driver3pl.token,
      body: {
        plateNumber: `EG-QA-${Math.floor(1000 + Math.random() * 8999)}`,
        vehicleType: 'box_truck',
        capacityTons: 15,
        envPermitNo: `WMRA-QA-${Date.now().toString().slice(-5)}`,
        permitExpiry: '2028-12-31',
        driverName: 'Mahmoud Saeed',
      },
    });
    assert.equal(vehRes.status, 201, `Vehicle registration failed: ${vehRes.text}`);
    const vehicleId = vehRes.body.vehicle.id;

    // scheduled -> accepted (with vehicleId)
    const sAccepted = await req(`/api/reservations/${activeResId}/status`, {
      method: 'PATCH',
      token: driver3pl.token,
      body: { nextStatus: 'accepted', vehicleId },
    });
    assert.equal(sAccepted.status, 200);

    // accepted -> en_route -> arrived
    assert.equal(
      (
        await req(`/api/reservations/${activeResId}/status`, {
          method: 'PATCH',
          token: driver3pl.token,
          body: { nextStatus: 'en_route' },
        })
      ).status,
      200
    );
    assert.equal(
      (
        await req(`/api/reservations/${activeResId}/status`, {
          method: 'PATCH',
          token: driver3pl.token,
          body: { nextStatus: 'arrived' },
        })
      ).status,
      200
    );

    // Wrong QR code on picked_up MUST fail 400
    const badQr = await req(`/api/reservations/${activeResId}/status`, {
      method: 'PATCH',
      token: driver3pl.token,
      body: {
        nextStatus: 'picked_up',
        qrPassportCode: 'OURO-PAS-2026-WRONG99',
        handoffWeightKg: 2000,
      },
    });
    assert.equal(badQr.status, 400, `QR mismatch should fail 400, got ${badQr.status}`);

    // Matching QR code succeeds
    const pickedUp = await req(`/api/reservations/${activeResId}/status`, {
      method: 'PATCH',
      token: driver3pl.token,
      body: {
        nextStatus: 'picked_up',
        qrPassportCode: racePassportCode,
        handoffWeightKg: 2000,
        handoffVerificationMethod: 'ble_scale',
      },
    });
    assert.equal(pickedUp.status, 200);

    // Upload real PNG Proof of Delivery
    const podUpload = await uploadFile(
      driver3pl.token,
      'pod_document',
      'QA_POD_Signed.png',
      'image/png',
      Buffer.from(SAMPLE_PNG_BASE64, 'base64')
    );
    assert.equal(podUpload.status, 201, `POD upload failed: ${podUpload.text}`);

    // picked_up -> delivered
    const delivered = await req(`/api/reservations/${activeResId}/status`, {
      method: 'PATCH',
      token: driver3pl.token,
      body: {
        nextStatus: 'delivered',
        podFileId: podUpload.body.id,
        podFileName: podUpload.body.originalName,
      },
    });
    assert.equal(delivered.status, 200);

    // CRITICAL INVARIANT: Passport is Stage 6 DELIVERED, NOT RECYCLED, and verifiedCo2eTons === 0!
    const afterDelivery = await req(`/api/passports/${racePassportCode}`, { token: generator.token });
    assert.equal(afterDelivery.status, 200);
    assert.equal(afterDelivery.body.passport.lifecycleStatus, 'DELIVERED');
    assert.equal(afterDelivery.body.passport.currentStage, 6);
    assert.equal(afterDelivery.body.passport.recycledTons, 0);
    assert.equal(afterDelivery.body.passport.verifiedCo2eTons, 0);
  });

  // 8. Stage 7 Facility Weighbridge Intake + Verified Recycling + Mass-Balance Guard + Net CO2e + ESG Separation
  await test('8. Stage 7 intake, mass-balance guard, verified recycling net CO2e & ESG report separation', async () => {
    // Upload weighbridge ticket PDF
    const wbUpload = await uploadFile(
      factoryApproved.token,
      'weighbridge_ticket',
      'QA_Weighbridge_2000kg.pdf',
      'application/pdf',
      Buffer.from(SAMPLE_PDF_BASE64, 'base64')
    );
    assert.equal(wbUpload.status, 201, `Weighbridge upload failed: ${wbUpload.text}`);

    // Confirm physical intake (still DELIVERED, NOT RECYCLED)
    const intakeRes = await req(`/api/reservations/${activeResId}/receive`, {
      method: 'POST',
      token: factoryApproved.token,
      body: {
        receivedWeightKg: 1980,
        weighbridgeFileId: wbUpload.body.id,
        weighbridgeFileName: wbUpload.body.originalName,
      },
    });
    assert.equal(intakeRes.status, 200);
    assert.equal(intakeRes.body.reservation.receiptStatus, 'received');

    // Mass-balance overclaim (3.5t recovered on 1.98t delivered) MUST fail 400
    const overclaim = await req(`/api/reservations/${activeResId}/recycle`, {
      method: 'POST',
      token: factoryApproved.token,
      body: { recoveredTons: 3.5, residualTons: 0, lossTons: 0 },
    });
    assert.equal(overclaim.status, 400, `Mass balance overclaim must fail 400, got ${overclaim.status}`);

    // Upload verified recycling evidence PDF
    const recUpload = await uploadFile(
      factoryApproved.token,
      'recycling_evidence',
      'QA_PET_Flakes_Batch_Cert.pdf',
      'application/pdf',
      Buffer.from(SAMPLE_PDF_BASE64, 'base64')
    );
    assert.equal(recUpload.status, 201, `Recycling evidence upload failed: ${recUpload.text}`);

    // Submit valid Stage 7 recycling evidence as Factory (2-step governance: enters 'submitted_for_verification', stays Stage 6 DELIVERED!)
    const recycleSubmitRes = await req(`/api/reservations/${activeResId}/recycle`, {
      method: 'POST',
      token: factoryApproved.token,
      body: {
        recoveredTons: 1.82,
        residualTons: 0.12,
        lossTons: 0.04,
        recyclingEvidenceFileId: recUpload.body.id,
        recyclingEvidenceName: recUpload.body.originalName,
        recyclingNotes: 'Hot-washed food-grade rPET flake batch submitted for independent verification.',
      },
    });
    assert.equal(recycleSubmitRes.status, 200, `Recycle evidence submit failed: ${recycleSubmitRes.text}`);
    assert.equal(recycleSubmitRes.body.verificationPending, true);
    assert.equal(recycleSubmitRes.body.reservation.recyclingStatus, 'submitted_for_verification');
    assert.equal(recycleSubmitRes.body.reservation.co2eAvoidedTons, 0);
    assert.equal(recycleSubmitRes.body.passport.lifecycleStatus, 'DELIVERED');
    assert.equal(recycleSubmitRes.body.passport.currentStage, 6);
    assert.equal(recycleSubmitRes.body.passport.verifiedCo2eTons, 0);

    // Confirm unverified submission does NOT yet inflate ESG verified totals
    const esgBeforeApproval = await req('/api/esg/report', { token: admin.token });
    assert.equal(esgBeforeApproval.status, 200);
    assert.ok(
      !esgBeforeApproval.body.items.some((i: any) => i.passportCode === racePassportCode),
      'Unverified factory submission must NOT appear in verified Stage 7 ESG totals'
    );

    // Independent Admin/Verifier rejects once -> stays DELIVERED with 0 CO2e
    const rejectRes = await req(`/api/admin/reservations/${activeResId}/verify-recycling`, {
      method: 'POST',
      token: admin.token,
      body: {
        decision: 'rejected',
        reason: 'QA verifier check: request clearer batch QC stamp before sealing Stage 7.',
      },
    });
    assert.equal(rejectRes.status, 200, `Admin reject failed: ${rejectRes.text}`);
    assert.equal(rejectRes.body.reservation.recyclingStatus, 'verification_rejected');
    assert.equal(rejectRes.body.passport.lifecycleStatus, 'DELIVERED');
    assert.equal(rejectRes.body.passport.verifiedCo2eTons, 0);

    // Factory resubmits corrected evidence
    const resubmitRes = await req(`/api/reservations/${activeResId}/recycle`, {
      method: 'POST',
      token: factoryApproved.token,
      body: {
        recoveredTons: 1.82,
        residualTons: 0.12,
        lossTons: 0.04,
        recyclingEvidenceFileId: recUpload.body.id,
        recyclingEvidenceName: recUpload.body.originalName,
        recyclingNotes: 'Resubmitted with stamped QC lab certificate and weighbridge ticket.',
      },
    });
    assert.equal(resubmitRes.status, 200, `Recycle resubmit failed: ${resubmitRes.text}`);
    assert.equal(resubmitRes.body.reservation.recyclingStatus, 'submitted_for_verification');

    // Independent Admin/Verifier approves -> seals Stage 7 RECYCLED & verified net CO2e!
    const approveRes = await req(`/api/admin/reservations/${activeResId}/verify-recycling`, {
      method: 'POST',
      token: admin.token,
      body: {
        decision: 'approved',
        reason: 'Weighbridge 1,980 kg intake and rPET flake QC batch certificate independently audited.',
      },
    });
    assert.equal(approveRes.status, 200, `Admin approve failed: ${approveRes.text}`);
    assert.equal(approveRes.body.passport.lifecycleStatus, 'RECYCLED');
    assert.equal(approveRes.body.passport.currentStage, 7);
    assert.equal(approveRes.body.reservation.recyclingStatus, 'verified_recycled');
    assert.equal(approveRes.body.reservation.esgConfidenceLevel, 'verified');
    assert.ok(approveRes.body.impact.transportEmissionsTons >= 0);
    assert.ok(
      approveRes.body.impact.netVerifiedCo2eTons < approveRes.body.impact.grossRecyclingCo2eTons + 0.001,
      'Net CO2e must account for road-adjusted freight transport deduction'
    );

    // Verify ESG Report strictly separates Stage 7 Verified Recycled items from Delivered-Pending items
    const esgRes = await req('/api/esg/report', { token: admin.token });
    assert.equal(esgRes.status, 200);
    assert.ok(
      esgRes.body.items.some((i: any) => i.passportCode === racePassportCode),
      'Verified recycled passport should appear in ESG Stage 7 items'
    );
    assert.ok(
      !esgRes.body.deliveredPendingItems.some((i: any) => i.reservationId === activeResId),
      'Verified recycled shipment must not appear in deliveredPendingItems'
    );
    assert.ok(
      esgRes.body.methodologyDisclosure?.limitations?.geographicScope &&
        esgRes.body.methodologyDisclosure?.limitations?.transportAssumption &&
        esgRes.body.methodologyDisclosure?.limitations?.verifierRequirement,
      'ESG report must include explicit scientific methodology limitations'
    );
    // Seeded OURO-PAS-2026-205B94 should be in deliveredPendingItems (Stage 6 DELIVERED, 0 verified CO2e)
    assert.ok(
      esgRes.body.deliveredPendingItems.some((i: any) => i.passportCode === 'OURO-PAS-2026-205B94'),
      'Seeded delivered-only lot OURO-PAS-2026-205B94 must remain in deliveredPendingItems'
    );
  });

  // 9. SHA-256 Tamper-Evident Hash Chain Verification
  await test('9. SHA-256 tamper-evident hash chain verification on complete 7-stage passport', async () => {
    const detail = await req(`/api/passports/${racePassportCode}`, { token: admin.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.chainIntegrity.valid, true, 'SHA-256 hash chain verification failed!');
    assert.ok(
      detail.body.chainIntegrity.eventCount >= 8,
      `Expected >= 8 chained custody events, got ${detail.body.chainIntegrity.eventCount}`
    );
  });

  // 10. Dispute Workflow, Live Emission Factor Update/Restore, Notifications & System Health
  await test('10. Dispute workflow, live emission factors, notifications & system health', async () => {
    // Generator opens dispute
    const openDisp = await req('/api/disputes', {
      method: 'POST',
      token: generator.token,
      body: {
        reservationId: activeResId,
        passportId: racePassportId,
        category: 'weight_discrepancy',
        subject: 'QA Test 20kg weighbridge delta verification',
        description: 'Automated QA verification of dispute submission and admin resolution workflow.',
      },
    });
    assert.equal(openDisp.status, 201);
    const disputeId = openDisp.body.dispute.id;

    // Admin resolves dispute
    const resolveDisp = await req(`/api/admin/disputes/${disputeId}`, {
      method: 'PATCH',
      token: admin.token,
      body: {
        status: 'resolved',
        resolutionNote: 'Verified 1% weighbridge moisture tolerance within contract bounds.',
      },
    });
    assert.equal(resolveDisp.status, 200);
    assert.equal(resolveDisp.body.dispute.status, 'resolved');

    // Verify generator received in-app notification
    const notifs = await req('/api/notifications', { token: generator.token });
    assert.equal(notifs.status, 200);
    assert.ok(Array.isArray(notifs.body.notifications) && notifs.body.notifications.length > 0);
    assert.ok(notifs.body.emailProviderStatus, 'Expected honest emailProviderStatus payload');

    // Live emission factor read, update, and restore
    const efList = await req('/api/emission-factors', { token: admin.token });
    assert.equal(efList.status, 200);
    const organicEf = efList.body.emissionFactors.find((e: any) => e.materialCategory === 'organic');
    assert.ok(organicEf);

    const efUpd = await req('/api/admin/emission-factors/organic', {
      method: 'PATCH',
      token: admin.token,
      body: {
        co2eFactorPerTon: 0.91,
        transportFactorKgPerTonKm: organicEf.transportFactorKgPerTonKm,
        version: organicEf.version,
        reason: 'QA emission factor update check',
      },
    });
    assert.equal(efUpd.status, 200);
    assert.equal(efUpd.body.emissionFactor.co2eFactorPerTon, 0.91);

    // Restore original organic factor
    const efRestore = await req('/api/admin/emission-factors/organic', {
      method: 'PATCH',
      token: admin.token,
      body: {
        co2eFactorPerTon: organicEf.co2eFactorPerTon,
        transportFactorKgPerTonKm: organicEf.transportFactorKgPerTonKm,
        version: organicEf.version,
        reason: 'QA restore baseline emission factor',
      },
    });
    assert.equal(efRestore.status, 200);

    // System health endpoint
    const sysHealth = await req('/api/admin/system-health', { token: admin.token });
    assert.equal(sysHealth.status, 200);
    assert.equal(sysHealth.body.status, 'healthy');
    assert.equal(sysHealth.body.database.connected, true);
    assert.equal(sysHealth.body.storage.magicByteValidation, true);
  });

  // 11. Generator Self-Registration Governance (No Auto-Approval + Verification Gate)
  let newGenToken = '';
  let newGenHubId = 0;
  let newGenUserId = 0;
  await test('11. New Waste Generator starts pending, blocked from listing until Admin verifies', async () => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 999)}`;
    const regRes = await req('/api/auth/register-generator', {
      method: 'POST',
      body: {
        facilityName: `QA Cairo Logistics Hub ${uniqueSuffix}`,
        facilityType: 'commercial',
        commercialRegNo: `CR-QA-${uniqueSuffix.slice(-6)}`,
        governorate: 'Greater Cairo',
        address: 'Plot 14, Industrial Service Zone, Cairo',
        contactPerson: 'Hossam Nabil',
        phone: '+201001234567',
        email: `qa-gen-${uniqueSuffix}@example.eg`,
        password: 'QaStrongPassword#2026',
        maxCapacityTons: 25,
      },
    });
    assert.equal(regRes.status, 201, `Generator registration failed: ${regRes.text}`);
    newGenToken = regRes.body.token;
    newGenHubId = regRes.body.user.hubId;
    newGenUserId = regRes.body.user.id;
    assert.ok(newGenHubId > 0, 'Expected hubId on newly registered generator user');

    const adminQueue = await req('/api/admin/overview', { token: admin.token });
    assert.equal(adminQueue.status, 200);
    assert.ok(adminQueue.body.kpis.pendingGenerators >= 1, 'Expected kpis.pendingGenerators >= 1');
    const createdHub = (adminQueue.body.hubs || []).find((h: any) => h.id === newGenHubId);
    assert.ok(createdHub, 'Expected newly registered generator in Admin hubs directory');
    assert.equal(createdHub.verificationStatus, 'pending', 'New generator MUST start pending');

    // Pending generator MUST be blocked (403) from minting passports
    const blockedMint = await req('/api/passports', {
      method: 'POST',
      token: newGenToken,
      body: {
        materialCategory: 'paper_cardboard',
        materialSubtype: 'Blocked Pending Lot',
        purityGrade: 'Grade A',
        weightKg: 1500,
        pricePerTonEgp: 9000,
      },
    });
    assert.equal(blockedMint.status, 403, `Pending generator should be blocked 403, got ${blockedMint.status}`);

    // Admin verifies generator with mandatory audit note
    const verifyRes = await req(`/api/admin/hubs/${newGenHubId}/verify`, {
      method: 'PATCH',
      token: admin.token,
      body: {
        status: 'verified',
        reason: 'Commercial registration and waste storage compliance audited.',
      },
    });
    assert.equal(verifyRes.status, 200, `Admin hub verify failed: ${verifyRes.text}`);
    assert.equal(verifyRes.body.hub.verificationStatus, 'verified');

    // Now verified generator can mint & cancel a test lot
    const allowedMint = await req('/api/passports', {
      method: 'POST',
      token: newGenToken,
      body: {
        materialCategory: 'paper_cardboard',
        materialSubtype: 'QA Post-Verification OCC Lot',
        purityGrade: 'Grade A',
        weightKg: 1500,
        pricePerTonEgp: 9200,
      },
    });
    assert.equal(allowedMint.status, 201, `Verified generator mint failed: ${allowedMint.text}`);

    // Clean up newly minted QA lot
    await req(`/api/passports/${allowedMint.body.passport.id}`, {
      method: 'DELETE',
      token: newGenToken,
    });
  });

  // 12. Object-Level Authorization on GET /api/passports/:codeOrId
  await test('12. Object-level passport access control blocks unrelated generators and pending factories', async () => {
    // Unrelated generator (newGenToken) MUST get 403 on Smart Village's racePassportCode
    const unrelatedGenRes = await req(`/api/passports/${racePassportCode}`, { token: newGenToken });
    assert.equal(
      unrelatedGenRes.status,
      403,
      `Unrelated generator must get 403 on another hub's passport, got ${unrelatedGenRes.status}`
    );

    // Non-participating factory inspecting an active lot with remaining stock (1.0t) gets strictly redacted preview (0 private reservations, Stages 1-3 only)
    const previewRes = await req(`/api/passports/${racePassportCode}`, { token: factoryPending.token });
    assert.equal(previewRes.status, 200);
    assert.equal(
      (previewRes.body.reservations || []).length,
      0,
      'Prospective buyer preview must hide other buyers private reservations'
    );
    assert.ok(
      (previewRes.body.events || []).every((e: any) => e.stage <= 3),
      'Prospective buyer preview must only expose Stages 1-3 listing metadata'
    );

    // Non-participating factory MUST get 403 on a closed / fully-allocated passport
    const ov = await req('/api/admin/overview', { token: admin.token });
    const closedPassport = (ov.body.passports || []).find(
      (p: any) => Number(p.availableTons) < 0.5 && p.lifecycleStatus === 'RECYCLED'
    );
    assert.ok(closedPassport, 'Expected at least one closed Stage 7 passport in DB');
    const closedPassportRes = await req(`/api/passports/${closedPassport.passportCode}`, {
      token: factoryPending.token,
    });
    assert.equal(
      closedPassportRes.status,
      403,
      `Non-participating factory must get 403 on closed Stage 7 passport (${closedPassport.passportCode}), got ${closedPassportRes.status}`
    );

    // Owning generator, participating buyer factory, and admin MUST get 200 with full chain
    assert.equal((await req(`/api/passports/${racePassportCode}`, { token: generator.token })).status, 200);
    assert.equal((await req(`/api/passports/${racePassportCode}`, { token: factoryApproved.token })).status, 200);
    assert.equal((await req(`/api/passports/${racePassportCode}`, { token: admin.token })).status, 200);
  });

  // 13. Strict User-Level Notification Isolation
  await test('13. User-level notification isolation prevents same-role cross-organization leakage', async () => {
    // User A (Smart Village generator) has user-specific notifications (e.g. dispute resolved, recycling verified)
    const userANotifs = await req('/api/notifications', { token: generator.token });
    assert.equal(userANotifs.status, 200);
    const privateNotifA = (userANotifs.body.notifications || []).find(
      (n: any) => n.userId === generator.user.id
    );
    assert.ok(privateNotifA, 'Expected at least one user-scoped notification for generator User A');

    // User B (newly registered generator with same role 'generator_ops') MUST NOT see User A's notification
    const userBNotifs = await req('/api/notifications', { token: newGenToken });
    assert.equal(userBNotifs.status, 200);
    const leaked = (userBNotifs.body.notifications || []).some((n: any) => n.id === privateNotifA.id);
    assert.equal(leaked, false, 'User B MUST NOT receive User A user-scoped notification');

    // User B attempting to mark User A's notification read MUST receive 403
    const crossRead = await req(`/api/notifications/${privateNotifA.id}/read`, {
      method: 'PATCH',
      token: newGenToken,
    });
    assert.equal(
      crossRead.status,
      403,
      `Cross-user notification read attempt must return 403, got ${crossRead.status}`
    );

    // Clean up temporary QA generator user so database remains tidy
    await req(`/api/admin/users/${newGenUserId}`, {
      method: 'PATCH',
      token: admin.token,
      body: { isActive: false, reason: 'QA post-test deactivation of temporary generator account' },
    });
  });

  // 14. ESG Engine Math Unit Checks + Live Readiness Probe + Correlation Header
  await test('14. ESG engine unit checks (1.25x circuity & confidence tiers), /api/ready & X-Request-Id', async () => {
    const plasticFactor = DEFAULT_EMISSION_FACTORS.find((f) => f.materialCategory === 'plastics')!;
    assert.ok(plasticFactor);

    // Verified: requires verifierApproved=true AND BOTH weighbridge ticket AND recycling evidence
    const verifiedImpact = calculateVerifiedRecyclingImpact({
      recoveredTons: 10,
      deliveredTons: 11,
      residualTons: 0.7,
      lossTons: 0.3,
      transportDistanceKm: 100,
      factor: plasticFactor,
      hasWeighbridgeTicket: true,
      hasRecyclingEvidence: true,
      verifierApproved: true,
    });
    assert.equal(verifiedImpact.effectiveRoadKm, 125); // 100 * 1.25 road circuity
    assert.equal(verifiedImpact.grossRecyclingCo2eTons, 15.2); // 10 * 1.52
    assert.equal(verifiedImpact.transportEmissionsTons, 0.144); // (11 * 125 * 0.105) / 1000 = 0.144375 -> 0.144
    assert.equal(verifiedImpact.netVerifiedCo2eTons, 15.056);
    assert.equal(verifiedImpact.confidenceLevel, 'verified');

    // Missing weighbridge ticket downgrades to 'calculated' even if verifier approved
    const calculatedImpact = calculateVerifiedRecyclingImpact({
      recoveredTons: 10,
      deliveredTons: 11,
      residualTons: 0.7,
      lossTons: 0.3,
      transportDistanceKm: 100,
      factor: plasticFactor,
      hasWeighbridgeTicket: false,
      hasRecyclingEvidence: true,
      verifierApproved: true,
    });
    assert.equal(calculatedImpact.confidenceLevel, 'calculated');

    // Pre-approval projection is strictly 'estimated'
    const estimatedImpact = calculateVerifiedRecyclingImpact({
      recoveredTons: 10,
      deliveredTons: 11,
      residualTons: 0.7,
      lossTons: 0.3,
      transportDistanceKm: 100,
      factor: plasticFactor,
      hasWeighbridgeTicket: true,
      hasRecyclingEvidence: true,
      verifierApproved: false,
    });
    assert.equal(estimatedImpact.confidenceLevel, 'estimated');

    // Live DB readiness probe + X-Request-Id header
    const readyRes = await req('/api/ready');
    assert.equal(readyRes.status, 200, `Readiness probe failed: ${readyRes.text}`);
    assert.equal(readyRes.body?.ready, true);
    assert.ok(readyRes.headers.get('x-request-id'), 'Expected X-Request-Id correlation header');
  });

  // Clean up second QA reservation so test run leaves minimal open queue clutter
  if (winningReservationIds[1]) {
    await req(`/api/reservations/${winningReservationIds[1]}/cancel`, {
      method: 'POST',
      token: factoryApproved.token,
      body: { reason: 'QA post-test cleanup' },
    });
  }

  console.log(`\nALL ${passed} END-TO-END QA SUITES PASSED SUCCESSFULLY!\n`);
}

main().catch((err) => {
  console.error('\nQA SUITE FAILED:', err);
  process.exit(1);
});

# OURO Platform Hardening & Verification Walkthrough

## Overview
This walkthrough documents the Phase 3 security hardening, authentication & authorization upgrades, multi-tenant organization isolation, PostgreSQL schema/migration/backup hardening, environment validation, and live end-to-end automated verification executed against the OURO Digital Waste Management SaaS platform (`server.ts`, PostgreSQL via Drizzle ORM, React 19 + TypeScript + Vite SPA).

---

# Security Summary

### 1. Immediate Server-Side Session Revocation & Non-Blocking Password Hashing
- **Finding:** Signed `ouro.` role session tokens previously stayed valid until natural 12-hour expiry even after sign-out, password hashing used synchronous `scryptSync` on the Node.js event loop, and Firebase ID token verification did not enforce Firebase token revocation.
- **Safeguard Implemented:**
  - Added unique `jti` token identifiers and `POST /api/auth/logout` backed by `getCacheProvider()` (in-memory in dev, Redis across replicas in production) so signed-out sessions are immediately rejected (`401`). The frontend sign-out flow now calls `POST /api/auth/logout` before clearing in-memory credentials.
  - Switched login and registration flows to non-blocking async `crypto.scrypt` (`hashPasswordAsync` / `verifyPasswordAsync`).
  - Enabled Firebase revocation checking via `adminAuth.verifyIdToken(token, true)` and added portable cloud initialization (`FIREBASE_PROJECT_ID` / `FIREBASE_SERVICE_ACCOUNT_JSON`).

### 2. Firebase Email Verification & Cross-Provider Account Takeover Guard
- **Finding:** Account linking by email during Firebase sign-in previously did not require `email_verified === true` and could overwrite an already-bound Firebase UID, and a fallback personal bootstrap admin email remained active regardless of environment.
- **Safeguard Implemented:** Added `evaluateFirebaseLinkPolicy()` in `src/middleware/auth.ts` to require verified email before linking any existing account or granting bootstrap admin, block overwriting an already-bound non-`ouro-*` Firebase UID (`403`), and disable the hardcoded fallback admin email in `NODE_ENV=production` (requiring explicit `OURO_BOOTSTRAP_ADMIN_EMAIL`).

### 3. Closed Private File Hijacking & Unauthenticated Weigh-In Photo Scraping
- **Finding:** `GET /api/storage/:id` previously allowed unauthenticated downloads of `weighin_photo` objects, and document attachment routes accepted arbitrary `file_objects` IDs without validating file ownership or purpose.
- **Safeguard Implemented:**
  - `canUserAccessFile()` and `GET /api/storage/:id` now require authentication (or a valid 5-minute HMAC `?sig=` token) for **all** stored files including `weighin_photo`, while workspace, marketplace, and passport endpoints emit short-lived signed photo URLs scoped to the authenticated viewer.
  - Added `assertFileAttachable()` inside transaction boundaries on passport creation, Stage 6 intake, Stage 7 recycling submission, and 3PL POD updates to verify every attached file exists, matches the expected purpose, and belongs to the caller's organization (`403` on cross-organization hijacking attempts).
  - Extended `DELETE /api/storage/:id` to prevent deleting files referenced by `waste_passports.photo_file_id`.

### 4. Closed Null-Organization Multi-Tenant Leaks & Cross-Tenant Writes
- **Finding:** Several routes (`GET /api/marketplace/lots`, `GET /api/driver/vehicles`, `GET /api/factory/reservations`, `GET /api/generator/transactions.csv`, `GET /api/esg/report`, `GET /api/esg/export.csv`, and `PATCH /api/factory/profile`) could return unscoped data or accept a body-supplied `factoryId` if a non-admin user lacked an organization ID, and `POST /api/disputes` did not verify the caller was a party to the referenced transaction.
- **Safeguard Implemented:**
  - Enforced strict role + organization checks across all four roles (`generator_ops`, `factory_procurement`, `driver_3pl`, `platform_admin`), returning `403` if a non-admin lacks a bound organization.
  - Restricted `GET /api/marketplace/lots` strictly to `factory_procurement` and `platform_admin`.
  - Locked `PATCH /api/factory/profile` so `factory_procurement` can only update their own `factoryId` (and returns `400` on empty updates).
  - Hardened `POST /api/disputes` to verify the referenced reservation or passport exists and belongs to the caller's organization (`403` otherwise).

### 5. Strict 3PL Sequential Workflow, Mandatory Pickup QR & Concurrency Locks
- **Finding:** `PATCH /api/reservations/:id/status` previously allowed jumping across pickup stages, allowed `picked_up` without providing `qrPassportCode`, did not verify `vehicleId` ownership, and locked only the `reservations` row.
- **Safeguard Implemented:** Acquired `FOR UPDATE` row locks on `reservations`, `waste_passports`, and `waste_source_hubs` inside the transaction; enforced strict step-by-step progression (`scheduled -> accepted -> en_route -> arrived -> picked_up -> delivered`, returning `409` on skips); made `qrPassportCode` mandatory on `picked_up` (`400` if omitted); and verified `vehicleId` exists, is active (`400` otherwise), and belongs to the assigned 3PL carrier (`403` otherwise).

### 6. Strict CORS Allowlist, Hardened Security Headers & Production Env Validation
- **Safeguard Implemented:**
  - Disabled `X-Powered-By`, tightened JSON body limit to `1mb`, mounted a general API rate limiter (`300 req/min`), added `X-Permitted-Cross-Domain-Policies: none`, and enabled production `Strict-Transport-Security` + `Content-Security-Policy`.
  - Added `createCorsMiddleware(ALLOWED_ORIGINS)` enforcing explicit origin allowlist + same-origin matching, `Vary: Origin`, and `403` rejection on disallowed preflight and cross-origin state-changing requests.
  - Added `validateEnvironmentConfig()` so `NODE_ENV=production` fails fast if signing secrets are missing or shorter than 32 characters, database connectivity is missing, or multi-instance production lacks Redis.
  - Generated versioned baseline Drizzle SQL migration (`drizzle/0000_baseline_ouro_schema.sql`), documented backup/restore/PITR runbooks (`DATABASE_BACKUP_RESTORE.md`), security architecture (`SECURITY.md`), and environment templates (`.env.development.template`, `.env.staging.template`, `.env.production.template`).

### 7. Dependency Audit Disclosure
- Running `bun audit` identified 5 transitive advisories in upstream packages:
  - 1 high and 1 low in `@grpc/grpc-js@1.9.16` (pulled transitively by `firebase` / `firebase-admin`).
  - 3 moderate in dev/build tooling (`esbuild` inside `drizzle-kit`, and `glob` / `minimatch` inside `vite-plugin-pwa`).
- Zero frontend secret leakage was confirmed across `src/` and `vite.config.ts` (only public `VITE_APP_ENV` and HTTP-referrer-restricted `VITE_GOOGLE_MAPS_API_KEY` are read client-side).

---

## PoC Verification

All automated unit suites and live end-to-end verification suites were executed after the final Phase 3 code edits against the compiled Express + PostgreSQL server (`http://localhost:3000`).

### 1. Vitest Unit & Security Suites (`npx vitest run` — 26 / 26 PASSED)
- **`tests/infra-cloud-agnostic.test.ts` (17 / 17 PASS):** Cloud-agnostic config, storage providers (local/S3/GCS), Redis vs memory cache guards, email, jobs, and redacted structured logging.
- **`tests/security-and-db.test.ts` (9 / 9 PASS):** Async salted `scrypt` password hashing, session token signing/tampering/immediate `jti` revocation, Firebase unverified-email and cross-provider UID hijack prevention, strict CORS allowlist and `403` rejection, production fail-fast environment validation, magic-byte MIME spoofing & authenticated `weighin_photo` ACLs, CSV formula injection neutralization, and Drizzle baseline migration parity (14 tables, 23 foreign keys, 17 explicit secondary indexes).

### 2. Core End-to-End QA Suite (`npx tsx tests/qa-suite.ts` — 14 / 14 PASSED)
| # | Test Suite | Observed Result |
|---|---|---|
| 1 | Auth, RBAC isolation, iframe-safe security headers & immediate deactivated-user blocking | **PASS** |
| 2 | Private storage magic-byte spoofing rejection, zero `?token=` bypass & 5-min signed URL ACLs | **PASS** |
| 3 | Cross-organization isolation across Waste Generators & 3PL Carriers | **PASS** |
| 4 | Waste listing create, edit, CSV formula-injection neutralization, and cancel lifecycle | **PASS** |
| 5 | Concurrency race test (4 simultaneous 2t bookings on 5t lot -> strictly 2 succeed `201`, 2 conflict `409`) | **PASS** |
| 6 | `Idempotency-Key` deduplication & atomic cancellation stock restoration | **PASS** |
| 7 | External 3PL vehicle registration, QR handoff mismatch rejection (`400`) & Stage 6 `DELIVERED != RECYCLED` (`0` verified CO2e) | **PASS** |
| 8 | Stage 7 weighbridge intake, mass-balance overclaim guard (`400`), 2-step independent verification, ESG report separation & limitations disclosure | **PASS** |
| 9 | SHA-256 tamper-evident hash chain verification across complete 7-stage passport | **PASS** |
| 10 | Dispute open/resolve workflow, live emission factor update/restore, notifications & `/api/admin/system-health` | **PASS** |
| 11 | New Waste Generator self-registration starts `pending`, blocked (`403`) until Admin verifies, then succeeds (`201`) | **PASS** |
| 12 | Object-level passport ACLs: unrelated generator blocked (`403`), prospective buyer gets redacted preview on active lot and `403` on closed passport | **PASS** |
| 13 | User-level notification isolation: same-role user in different organization blocked (`403`) | **PASS** |
| 14 | ESG engine unit assertions (`1.25x` circuity & confidence tiers), live DB readiness probe (`GET /api/ready` -> `200`) & `X-Request-Id` header | **PASS** |

### 3. Phase 3 Live Security & Database Verification (`npx tsx tests/phase3-live-security.ts` — 8 / 8 PASSED)
| # | Verification Check | Observed Result |
|---|---|---|
| 1 | No `X-Powered-By`, hardened headers (`X-Permitted-Cross-Domain-Policies: none`), disallowed CORS preflight & POST blocked (`403`) | **PASS** |
| 2 | `POST /api/auth/logout` immediately revokes bearer token (`401` on subsequent `/api/auth/me`) | **PASS** |
| 3 | `GET /api/marketplace/lots` blocks `generator_ops` & `driver_3pl` (`403`), permits `factory_procurement` & `platform_admin` (`200`) | **PASS** |
| 4 | Unauthenticated `GET /api/storage/:id` on `weighin_photo` rejected (`401`); signed URL succeeds (`200`) with `nosniff` | **PASS** |
| 5 | Cross-organization private file attachment hijacking blocked on `POST /api/passports` (`403`) | **PASS** |
| 6 | `PATCH /api/factory/profile` rejects empty payloads (`400`) and prevents `factory_procurement` from modifying another factory | **PASS** |
| 7 | Cross-org `POST /api/disputes` blocked (`403`), 3PL stage skipping blocked (`409`), omitted pickup QR blocked (`400`), invalid (`400`) & cross-carrier (`403`) vehicle IDs blocked | **PASS** |
| 8 | Live PostgreSQL schema parity verified: `14` public tables, `23` active foreign keys, `>= 42` indexes, healthy connection pool & `/api/ready` `{"ready":true,"database":true}` | **PASS** |

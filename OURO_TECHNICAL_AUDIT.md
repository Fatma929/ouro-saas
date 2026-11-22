# OURO — Full Technical Audit Report (Phase 1)

**Audit Date:** 2026-11-22  
**Scope:** Complete read-only forensic inspection of the existing OURO SaaS repository (frontend, backend, database, authentication, Digital Waste Passport, QR system, SHA-256 chain, marketplace, 3PL logistics, Stage 7 recycling verification, ESG engine, notifications, admin governance, file storage, rate limiting, Docker, CI/CD, and automated tests).  
**Phase 1 Rule Compliance:** Zero existing application files were modified during this audit, and no mutating scripts or test suites were executed against the database. All findings below are grounded in direct source-code inspection and read-only CLI checks (`grep`, directory inspection, and `bun audit`).

---

## Executive Summary

OURO already has a **substantive, working full-stack core** — not a frontend mockup. It runs an Express + TypeScript backend backed by PostgreSQL + Drizzle ORM (14 normalized tables), a React 19 + Tailwind CSS v4 bilingual (EN/AR RTL) PWA frontend, real row-locked transactional reservations (`SELECT ... FOR UPDATE`), an idempotency store, a 7-stage Digital Waste Passport with scannable QR generation/camera decoding, a SHA-256 hash-chained event log, a strict 3-status lifecycle (`LISTED` → `DELIVERED` → `RECYCLED`) with independent Stage 7 verifier sign-off, magic-byte-validated file uploads with HMAC-signed private download URLs, and a 14-check automated QA script.

However, **OURO is NOT yet safe or ready for multi-tenant production cloud deployment.** This audit identified **5 CRITICAL**, **10 HIGH**, **11 MEDIUM**, and **6 LOW** findings across security isolation, cloud deployability, broken CI/Docker builds, stubbed/documented-but-unimplemented integrations (Redis, Resend/SMTP email, object storage), workflow bypasses, and testing gaps.

| Severity | Count | Primary Blockers |
| :--- | :---: | :--- |
| **CRITICAL** | 5 | Multi-tenant data leaks when org IDs are `null`; unverified Firebase email account takeover; cross-org private file attachment hijacking; broken Docker/CI `npm ci` against `bun.lock`; ephemeral container-local disk storage. |
| **HIGH** | 10 | Stubbed Resend/SMTP email delivery; unimplemented Redis rate limiter + spoofable `X-Forwarded-For`; static `vite` import in production `server.ts`; `/api/health` blocked by DB seeding; 3PL stage-skip & QR verification bypass; PostgreSQL SSL/graceful shutdown/migrations absent; non-revocable session tokens & multi-replica random fallback secrets; unenforced reservation expiry; unauthenticated `weighin_photo` access; `PATCH /api/factory/profile` cross-tenant overwrite when `factoryId` is `null`. |
| **MEDIUM** | 11 | SHA-256 hash chain omits timestamps/coordinates & lacks DB immutability triggers; `tsconfig` lacks `strict: true` and ESLint; IEEE-754 floats for currency/weights & missing SQL `CHECK` constraints; 3PL vehicle auto-verification & naive carrier assignment; unverified dispute entity ownership; hardcoded fallback admin email & Firebase ADC lock-in; missing CORS/CSP/HSTS hardening; booking vs Stage 7 transport CO2e formula drift; Google Maps `DEMO_MAP_ID` & overlapping hub markers; unused `@google/genai` dependency; vulnerable transitive packages (`bun audit`: 1 high, 3 moderate, 1 low). |
| **LOW** | 6 | Monolithic 3,637-line `server.ts`; staging account directory bundled unless `VITE_APP_ENV=production` is set; missing password reset/change UI; offline queue not scoped per user or photo-capable; `DriverRouteMap` single-factory destination limitation; package/workspace hygiene (`package.json` name `"react-example"`, `dev-dist/` and leftover QA files in `storage/private/`). |

---

## 1. Existing Architecture

### 1.1 Runtime & Stack Overview
- **Runtime / Package Manager:** Node.js (target `node:20-slim` in `Dockerfile`, Node 20 in `.github/workflows/ci.yml`), installed locally with **Bun** (`bun.lock`, 232 KB; **no `package-lock.json`**).
- **Frontend:** React 19.0.0, TypeScript 5.8, Vite 6.2, Tailwind CSS 4.1 (`@tailwindcss/vite`), `vite-plugin-pwa` (Workbox), `lucide-react`, `recharts`, `qrcode.react`, `jsqr`, `@vis.gl/react-google-maps`, Firebase Web SDK (`firebase` 12.11).
- **Backend:** Express 4.21 in a monolithic root `/server.ts` (3,637 lines) plus one extracted router `/src/routes/platform-routes.ts` (899 lines). Dev mode runs `tsx server.ts` mounting `vite.middlewares` on port 3000; production serves static `/dist` from the same Express server.
- **Database:** PostgreSQL (`pg` 8.20) + Drizzle ORM 0.45 (`src/db/schema.ts`, `src/db/index.ts`, `src/db/drizzle.config.ts`). 14 tables:
  1. `waste_source_hubs` (B2B Waste Generators)
  2. `recycling_factories` (Industrial Recyclers + KYC)
  3. `logistics_providers` (Certified External 3PL Carriers)
  4. `logistics_vehicles` (External 3PL Partner Fleet)
  5. `users` (RBAC accounts linked to Firebase UID and/or local scrypt password hash)
  6. `waste_passports` (7-stage Digital Waste Passports + mass balance)
  7. `reservations` (Factory allocations + 3PL dispatch + Stage 6 receipt + Stage 7 recycling verification)
  8. `passport_events` (Append-only SHA-256 hash-chained audit trail)
  9. `file_objects` (Upload metadata & SHA-256 digest; binary stored on local disk)
  10. `admin_audit_logs` (Governance actions)
  11. `emission_factors` (Configurable IPCC/EPA/DEFRA factors per material category)
  12. `notifications` (In-app bilingual user notifications)
  13. `disputes` (Operational issue/dispute tickets)
  14. `idempotency_keys` (Cached request replay responses)
- **Authentication:** Hybrid dual-token scheme (`src/middleware/auth.ts`, `src/lib/auth-utils.ts`):
  - Custom HMAC-SHA256 `ouro.<payload>.<sig>` stateless bearer tokens (12h TTL) for email/phone/ID + password login (`scryptSync`).
  - Firebase ID tokens verified via `firebase-admin` (`adminAuth.verifyIdToken`) for Google Sign-In.
  - Client holds bearer token in JS memory (`src/lib/api.ts`), never `localStorage`.
- **RBAC Roles (4):** `generator_ops`, `factory_procurement`, `logistics_driver`, `platform_admin`.

### 1.2 Documentation Claims vs. Actual Implementation

| Feature / Claim | Documented Where | Actual Code Reality | Status |
| :--- | :--- | :--- | :--- |
| **PostgreSQL + Drizzle ORM + Transactions** | `docs/OPERATIONS_AND_DEPLOYMENT.md`, `walkthrough.md` | Real PostgreSQL queries, 14 tables, `FOR UPDATE` row locking on reservations & cancellations. However, **zero SQL migration files** exist (`./drizzle` directory does not exist); schema relies on `drizzle-kit push`. | **Partially Implemented** |
| **Redis Distributed Rate Limiting** | `.env.example` (`REDIS_URL`), `docs/OPERATIONS_AND_DEPLOYMENT.md` | `RateLimitStore` interface exists in `src/middleware/security.ts`, but **only `InMemoryRateLimitStore` is implemented**. No `ioredis`/`redis` dependency exists. | **Missing (Stubbed Config)** |
| **Transactional Email (Resend / SMTP)** | `.env.example`, `src/lib/notifications.ts`, `NotificationBell.tsx` | `getEmailProviderStatus()` reports *"transactional email dispatch enabled"* when `RESEND_API_KEY` or `SMTP_HOST` is set, **but `dispatchNotification()` only writes to PostgreSQL**. Zero email HTTP/SMTP code exists. | **Missing (Misleading Stub)** |
| **Cloud Object Storage (GCS / S3)** | `docs/OPERATIONS_AND_DEPLOYMENT.md`, `.env.example` | `src/lib/storage.ts` writes exclusively to local container disk (`./storage/private`). No GCS/S3 SDK or adapter exists. | **Missing (Local Disk Only)** |
| **Docker & GitHub Actions CI** | `Dockerfile`, `.github/workflows/ci.yml` | Both run `npm ci`, which **fails immediately** because the repo uses `bun.lock` and has no `package-lock.json`. | **Broken** |
| **Digital Waste Passport 7-Stage & Strict 3-Status Separation** | `walkthrough.md`, `server.ts` | Implemented end-to-end (`LISTED` → `DELIVERED` → `RECYCLED`), mass balance tracking, Stage 7 independent verifier queue, and ESG reporting strictly excluding `DELIVERED` lots from verified CO2e. | **Implemented** |
| **QR Generation & On-Site Camera Scanning** | `PassportQRCode.tsx`, `PassportQRScanner.tsx`, `src/lib/passport-qr.ts` | Real `qrcode.react` SVG/PNG/printable bale tag generation + `jsqr` camera & image file scanning. However, backend `PATCH /api/reservations/:id/status` allows omitting `qrPassportCode` and still marks `handoffQrVerified = true`. | **Implemented (with Server-Side Bypass Bug)** |
| **Web Bluetooth Industrial Scale** | `HubWorkerWorkspace.tsx` | Real `navigator.bluetooth.requestDevice()` targeting GATT Weight Scale (`0x181D` / `0x2A9D`) with explicit `manual_calibrated` fallback audit tagging. | **Implemented** |
| **Google Maps Platform (Interactive Map, Places New, Routes)** | `GoogleMapsProvider.tsx`, `HubMarketplaceMap.tsx`, `DriverRouteMap.tsx` | Real `@vis.gl/react-google-maps` + `Places` Autocomplete (New) + `Route.computeRoutes()` traffic-aware routing. Uses `DEMO_MAP_ID`, stacks overlapping lots at the same hub, and routes all stops to `activeJobs[0].factory`. | **Implemented (Production Polish Needed)** |
| **Gemini AI Backend Capability** | `package.json` (`@google/genai`), `metadata.json` (`MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`) | `@google/genai` is **never imported anywhere** in `src/` or `server.ts`. | **Unused Dependency / Metadata Mismatch** |

---

## 2. Component Maturity Breakdown

### 2.1 Implemented Components (Solid Core)
- **Bilingual EN/AR + RTL UI Architecture (`src/App.tsx`, `src/shared/i18n.ts`):** Clean role-routed workspace shell, brand palette (`#272F31`, `#3D7568`, `#A88B64`), zero Youth Center references, responsive layout, PWA registration (`usePWA.ts`, `vite-plugin-pwa`).
- **7-Stage Digital Waste Passport & Strict 3-Status Lifecycle (`server.ts`, `PassportModal.tsx`):** Strictly separates `LISTED`, `DELIVERED` (Stage 6), and `RECYCLED` (Stage 7 verified output). Enforces mass-balance reconciliation (`recovered + residual + loss <= deliveredTons * 1.01`).
- **Two-Step Stage 7 Verification (`server.ts` lines 2170–2390, `AdminCommandDashboard.tsx`):** Recycling facilities submit recovered/residual/loss tons + evidence (`submitted_for_verification`), and an independent `platform_admin` verifier must approve or reject before sealing Stage 7 and crediting verified CO2e.
- **Transactional Reservation Locking & Idempotency (`server.ts` lines 1630–1830):** Uses `db.transaction` + PostgreSQL `SELECT ... FOR UPDATE` on `waste_passports` and `waste_source_hubs`, preventing concurrent over-reservation, plus `Idempotency-Key` replay caching in PostgreSQL.
- **ESG Calculation Engine (`src/lib/esg-engine.ts`):** DB-backed configurable `emission_factors` table, transport-adjusted net avoided CO2e (`grossAvoided - transportEmissions`), transparent methodology/boundary disclosures, authenticated CSV export (with CSV formula-injection escaping), and printable ESG Certificate modal (`EsgCertificateModal.tsx`).
- **Real Web Bluetooth GATT Scale Intake (`HubWorkerWorkspace.tsx`):** Connects to standard `0x181D` BLE scales when supported, with tare/lock controls and honest `manual_calibrated` tagging when unavailable.
- **QR Code Generation, Bale Tags & Camera Scanner (`PassportQRCode.tsx`, `PassportQRScanner.tsx`, `src/lib/passport-qr.ts`):** Generates scannable URLs (`/?passport=OURO-...`), exports PNG/print tags, and decodes via camera or uploaded image using `jsqr`.
- **Private Upload Magic-Byte Validation & HMAC Signed Downloads (`src/lib/storage.ts`, `server.ts`):** Validates real file signatures (JPEG, PNG, WebP, PDF, UTF-8 text), enforces size limits (5 MB), records SHA-256 digests, and serves private files via short-lived (120s) HMAC-signed URLs bound to `userId` and `fileId` without passing bearer tokens in query strings.
- **Admin Governance Console (`AdminCommandDashboard.tsx`, `src/routes/platform-routes.ts`):** KYC queue, Waste Generator verification queue, Stage 7 recycling verification queue, 3PL licensing verification, Disputes desk, User activation/role management, live Emission Factors editor, System Health view, and Admin Audit Log.
- **Strict Onboarding Defaults (`server.ts` lines 536–586):** Self-registered recycling factories start as `kycStatus: 'pending'` (blocked from reserving), and self-registered waste generators start as `verificationStatus: 'pending'` (blocked from publishing lots).

### 2.2 Partially Implemented Components
- **Multi-Tenant Authorization & Data Isolation:** Present on most routes, but broken by fallback-to-unscoped queries when `hubId`/`factoryId`/`logisticsProviderId` is `null`, and missing file-ownership validation on attachment IDs.
- **Firebase Authentication Integration (`src/middleware/auth.ts`, `src/lib/firebase-admin.ts`):** Works for Google Sign-In in GCP/ADC environments, but does not enforce `email_verified`, has no service-account env var fallback for non-GCP clouds, and relies on a committed `firebase-applet-config.json`.
- **3PL Dispatch & Logistics Workflow (`server.ts`, `Driver3plWorkspace.tsx`, `DriverRouteMap.tsx`):** Supports 6 pickup states, vehicle registry, POD upload, and Google Routes rendering, but allows skipping intermediate pickup stages, allows bypassing QR verification server-side, auto-verifies newly added 3PL vehicles without admin approval, always assigns the single highest-`onTimeRate` carrier regardless of region/capacity, and routes all active stops to only the first job's factory.
- **SHA-256 Audit Chain (`src/lib/passport-chain.ts`):** Computes and verifies chained SHA-256 hashes per passport, but excludes `createdAt`, `summaryAr`, `lat`, and `lng` from the hashed payload, uses unescaped `|` delimiters, and lacks PostgreSQL triggers preventing direct `UPDATE`/`DELETE`.
- **Rate Limiting & HTTP Security (`src/middleware/security.ts`, `server.ts`):** Applies security headers and tiered rate limits, but uses in-memory storage only, trusts spoofable `X-Forwarded-For`, lacks CORS allowlist, CSP, and HSTS, and sets an oversized 10 MB JSON body limit.
- **Reservation Lifecycle (`server.ts`):** Sets `expiresAt` (+72 hours) on reservations, but has no background sweeper or lazy expiry handler to release abandoned reservations back to available stock.
- **Offline Intake Queue (`HubWorkerWorkspace.tsx`):** Queues JSON weigh-in metadata in `localStorage` and auto-syncs online, but cannot queue offline photos/PDFs and is not partitioned by `user.id`/`hubId`.

### 2.3 Missing Components
- **Distributed Rate Limiter (Redis):** No `ioredis`/`redis` package or `RedisRateLimitStore` implementation.
- **Transactional Email Dispatch (Resend / SMTP):** No outbound email client or worker; notifications are in-app DB rows only.
- **Persistent Cloud Object Storage (GCS / S3):** No cloud bucket driver for uploaded evidence/KYC files.
- **Versioned SQL Migration History:** No `./drizzle` migrations generated via `drizzle-kit generate` (only ad-hoc `drizzle-kit push`).
- **3PL Carrier Self-Registration / Onboarding Flow:** Generators and Factories can self-register (`POST /api/auth/register`), but 3PL companies cannot onboard themselves or submit transport license documents.
- **Password Reset / Account Recovery & Token Revocation:** No forgot-password flow, password-change endpoint, refresh tokens, or server-side logout/revocation list for `ouro.` tokens.
- **Automated Unit, Component, and Browser E2E Test Suites:** No Vitest/Jest unit tests, no React Testing Library tests, no Playwright E2E tests, and no automated negative security regression tests.
- **Graceful Shutdown & Structured Observability:** No `SIGTERM`/`SIGINT` server/DB pool drain, no structured JSON request logger (e.g., `pino`), and no metrics/error-tracking hook (OpenTelemetry/Sentry).

---

## 3. Security Findings

### CRITICAL

#### [CRIT-01] Multi-Tenant Data Leakage When User Lacks Organization Assignment
- **Locations:**
  - `src/middleware/auth.ts` lines 49–60 (`syncFirebaseUser` creates new Firebase users with `role: 'generator_ops'`, `hubId: null`)
  - `server.ts` lines 1192–1199 (`GET /api/generator/transactions.csv`)
  - `server.ts` lines 1412–1417 (`GET /api/marketplace/lots` — also lacks `requireRole`, open to any authenticated role)
  - `server.ts` lines 1579–1581 (`GET /api/factory/reservations`)
  - `server.ts` lines 3309–3320 (`GET /api/esg/report`)
  - `server.ts` lines 3459–3470 (`GET /api/esg/export.csv`)
  - `src/routes/platform-routes.ts` lines 38–44 (`GET /api/driver/vehicles`)
- **Vulnerability:** Multiple endpoints scope queries with patterns like `req.authUser!.role === 'generator_ops' && req.authUser!.hubId ? scopedQuery : unscopedQuery`. Whenever a non-admin user has a `null` organization foreign key (`hubId`, `factoryId`, or `logisticsProviderId`) — which happens **automatically for every brand-new Google Sign-In user** — the condition evaluates to `false` and falls through to the **unscoped platform-wide admin query**, leaking all tenants' waste passports, factory reservations, ESG ledgers, or 3PL fleets.
- **Remediation:** Invert the check everywhere: **only** allow unscoped queries when `req.authUser!.role === 'platform_admin'`. For every non-admin role, if their required org ID (`hubId` / `factoryId` / `logisticsProviderId`) is missing, return `403 Forbidden` (or an empty tenant-scoped result). Restrict `GET /api/marketplace/lots` KPI reservation queries to `factoryId` or `platform_admin`.

#### [CRIT-02] Firebase Account Takeover via Unverified Email Linking
- **Location:** `src/middleware/auth.ts` lines 39–50, 103–105
- **Vulnerability:** `resolveUserFromBearer()` verifies the Firebase ID token via `adminAuth.verifyIdToken(token)` without checking `decoded.email_verified === true`. `syncFirebaseUser()` then queries `users` by `email` and overwrites `users.uid = uid`, and auto-promotes to `platform_admin` if `email === OWNER_ADMIN_EMAIL`. If Firebase Email/Password sign-up or an unverified OAuth provider is enabled in the Firebase project, an attacker can register an unverified account with any existing user's (or the platform admin's) email address and hijack their OURO account.
- **Remediation:** Require `decoded.email_verified === true` before linking an existing email account or promoting an admin. Never overwrite an already-bound non-null `users.uid` with a different Firebase UID without explicit re-authentication/admin review.

#### [CRIT-03] Cross-Organization Private File Attachment Hijacking
- **Locations:**
  - `server.ts` lines 955–957 (`POST /api/passports` — `photoFileId`, `supportingDocFileId`)
  - `server.ts` line 2035 (`POST /api/reservations/:id/receive` — `weighbridgeFileId`)
  - `server.ts` line 2197 (`POST /api/reservations/:id/recycle` — `recyclingEvidenceFileId`)
  - `server.ts` line 2656 (`PATCH /api/reservations/:id/status` — `podFileId`)
  - `server.ts` lines 147–180 (`canUserAccessFileWithLinks`)
- **Vulnerability:** None of the mutation endpoints verify that the submitted integer `fileId` was uploaded by the authenticated caller (or belongs to their organization) or matches the expected `purpose`. Because `canUserAccessFileWithLinks()` grants signed download access to any file linked to a user's passport or reservation, an authenticated attacker can attach arbitrary sequential `file_objects.id` values belonging to another company (e.g., another factory's weighbridge tickets, PODs, or recycling evidence) to their own record and then download them. (Only `kyc_document` is blocked at line 144.)
- **Remediation:** Introduce a shared helper `assertOwnedFile(fileId, authUser, expectedPurpose)` that verifies `file_objects.uploadedByUserId === authUser.id` (or same organization / `platform_admin`) AND `file_objects.purpose === expectedPurpose` before linking any file ID to a passport, reservation, or KYC record.

### HIGH

#### [HIGH-01] Cross-Tenant Factory Profile Overwrite When `factoryId` Is Null
- **Location:** `server.ts` lines 1519–1528 (`PATCH /api/factory/profile`)
- **Vulnerability:** `const factoryId = req.authUser!.factoryId || Number(req.body?.factoryId);` allows a `factory_procurement` user whose `factoryId` is `null` to pass any other factory's ID in `req.body.factoryId` and modify that factory's procurement preferences and capacity.
- **Remediation:** Only read `req.body.factoryId` when `req.authUser!.role === 'platform_admin'`. For `factory_procurement`, strictly require `req.authUser!.factoryId` and reject with `403` if absent.

#### [HIGH-02] 3PL Handoff Can Skip Workflow Stages and Bypass QR Verification
- **Location:** `server.ts` lines 2517–2521, 2581–2599 (`PATCH /api/reservations/:id/status`)
- **Vulnerability:**
  1. Stage transition only checks `nextIdx <= curIdx`, allowing a 3PL user to jump directly from `scheduled` to `delivered` without `accepted`, `en_route`, `arrived`, or `picked_up` (bypassing QR handoff and weight deduction).
  2. When transitioning to `picked_up`, `if (qrPassportCode)` only checks the passport code if supplied — omitting `qrPassportCode` silently skips validation and still sets `handoffQrVerified = true`.
  3. Does not verify that `vehicleId` belongs to `current.logisticsProviderId` (and is active/verified).
  4. Updates `waste_passports` without a `FOR UPDATE` row lock during delivery/pickup updates.
- **Remediation:** Enforce strict sequential transitions (`nextIdx !== curIdx + 1` → `409 Conflict`), require non-empty `qrPassportCode` matching `passport.passportCode` on `picked_up`, validate `vehicle.providerId === current.logisticsProviderId`, and lock `waste_passports` inside the transaction.

#### [HIGH-03] Unauthenticated Public Access to `weighin_photo` Files
- **Location:** `server.ts` lines 694–697; `src/lib/storage.ts` line 164
- **Vulnerability:** `GET /api/storage/:id` bypasses authentication completely when `file.purpose === 'weighin_photo'`, exposing sequential integer file IDs to unauthenticated internet scraping. This contradicts the comment in `src/lib/storage.ts` stating weigh-in photos are *"visible to authenticated B2B marketplace users"*.
- **Remediation:** Require valid authentication or a short-lived signed URL for `weighin_photo` (or use unguessable UUIDs + authenticated image proxy/signed URLs for marketplace lot previews).

#### [HIGH-04] Rate Limiter IP Spoofing & Non-Distributed In-Memory Store
- **Location:** `src/middleware/security.ts` lines 28–79; `server.ts` lines 74–80
- **Vulnerability:** `getClientIp()` trusts the leftmost IP of the `X-Forwarded-For` header without configuring Express `trust proxy`, allowing any attacker to bypass login, registration, and upload rate limits simply by randomizing `X-Forwarded-For` per request. Additionally, `InMemoryRateLimitStore` resets on restart and does not share counters across horizontally scaled replicas.
- **Remediation:** Configure `app.set('trust proxy', 1)` (or exact cloud load-balancer hop count) and read `req.ip`. Implement `RedisRateLimitStore` backed by `REDIS_URL` with atomic `INCR`/`PEXPIRE` (or sliding window Lua script).

#### [HIGH-05] Stateless Session Tokens Lack Revocation + Unsafe Production Fallback Secrets + Blocking Password Hashing
- **Locations:** `src/lib/auth-utils.ts` lines 4–7, 13–24, 32–66; `src/lib/storage.ts` lines 8–13; `server.ts` lines 3602–3607
- **Vulnerability:**
  1. Custom `ouro.` tokens have a 12-hour lifetime with no server-side revocation/session table or token version check on logout or password/role change (a deactivated user is checked on DB lookup, which helps, but stolen tokens for active users cannot be invalidated on logout).
  2. If `OURO_SESSION_SECRET` or `OURO_FILE_SIGN_SECRET` is omitted in production, the app only prints `console.error` and falls back to `crypto.randomBytes(32)` — causing silent random auth/download failures across replicas and on restarts.
  3. `crypto.scryptSync` runs synchronously on the main Node event loop during login and registration, creating a CPU denial-of-service vector under concurrent auth requests.
- **Remediation:** Fail fast (`process.exit(1)`) in `NODE_ENV=production` if required secrets are missing or shorter than 32 chars; switch `hashPassword`/`verifyPassword` to async `crypto.scrypt`; add a `tokenVersion` column or Redis/DB session revocation mechanism plus explicit `/api/auth/logout` invalidation.

### MEDIUM

#### [MED-01] SHA-256 Audit Chain Omits Critical Fields & Lacks Database Immutability Enforcement
- **Location:** `src/lib/passport-chain.ts` lines 20–34; `src/db/schema.ts` (`passportEvents`)
- **Vulnerability:** `computePassportEventHash()` only hashes `passportId|stage|eventType|actorUserId|actorName|summaryEn|prevHash`. It omits `createdAt` (timestamp), `summaryAr`, `lat`, and `lng` — meaning timestamps and GPS coordinates could be modified in PostgreSQL without breaking chain verification. Using raw `|` separators without length-prefixing or canonical JSON also permits field-boundary ambiguity. No PostgreSQL `BEFORE UPDATE OR DELETE` trigger enforces append-only immutability on `passport_events` or `admin_audit_logs`.
- **Remediation:** Switch to canonical JSON (or length-delimited) hash input including `createdAt` ISO timestamp, `summaryAr`, `lat`, and `lng` (versioned hash algorithm field for backward compatibility with existing events), and add PostgreSQL triggers blocking `UPDATE`/`DELETE` on `passport_events` and `admin_audit_logs`.

#### [MED-02] Dispute Creation Does Not Verify Caller Participation in Referenced Entities
- **Location:** `src/routes/platform-routes.ts` lines 226–239 (`POST /api/disputes`)
- **Vulnerability:** Any authenticated user can file a dispute referencing any arbitrary `reservationId` or `passportId` across organizations without verifying they belong to the generator hub, recycling factory, or 3PL carrier involved.
- **Remediation:** Validate that referenced `reservationId`/`passportId` exist and that the caller's organization is a party to that transaction (or `platform_admin`).

#### [MED-03] Missing Express Security Hardening (CORS Allowlist, CSP, HSTS, Oversized JSON Limit, Unsanitized Request ID)
- **Locations:** `server.ts` lines 78–80; `src/middleware/security.ts` lines 10–25
- **Vulnerability:**
  - No explicit CORS middleware/allowlist configured for `ALLOWED_ORIGINS`.
  - No `Content-Security-Policy` or `Strict-Transport-Security` header in production.
  - `express.json({ limit: '10mb' })` is unnecessarily large for JSON API payloads (file uploads use `multer`, not JSON).
  - `X-Request-Id` echoes arbitrary user-supplied header values without character/length validation (risk of log injection).
- **Remediation:** Add strict CORS allowlist driven by `ALLOWED_ORIGINS`, enable HSTS + CSP in production, reduce `express.json` limit to `1mb`, and validate/truncate incoming `x-request-id` to `^[a-zA-Z0-9_-]{8,64}$`.

#### [MED-04] Hardcoded Fallback Bootstrap Admin Email & Exposed Production Firebase Client Config
- **Locations:** `src/middleware/auth.ts` line 28; `src/lib/firebase-admin.ts`; `firebase-applet-config.json`
- **Vulnerability:** `OWNER_ADMIN_EMAIL` defaults to a hardcoded personal email (`fatmaelzahraalegal@gmail.com`) when `OURO_BOOTSTRAP_ADMIN_EMAIL` is unset, automatically granting `platform_admin` privileges on login. Additionally, `firebase-applet-config.json` is committed in the repo root (client Firebase keys are public by design, but hardcoding a single project file blocks clean staging/prod separation).
- **Remediation:** Remove the hardcoded email fallback (require explicit `OURO_BOOTSTRAP_ADMIN_EMAIL` env var) and load Firebase client/admin configs from environment variables per deployment stage.

#### [MED-05] Vulnerable Transitive Dependencies (`bun audit` Verified)
- **Verified Output (`bun audit` on 2026-11-22):** **5 vulnerabilities (1 High, 3 Moderate, 1 Low):**
  - **High:** `@grpc/grpc-js@1.9.16` (via `firebase` / `firebase-admin` — `getAuthContext` certificate authorization bug, `<1.13.6`, GHSA-m9gg-hp2v-232j).
  - **Low:** `@grpc/grpc-js@1.9.16` (error message leakage in status messages, `<1.13.6`, GHSA-f596-whhp-79r4).
  - **Moderate:** `esbuild@0.18.20` (via `drizzle-kit` — dev server cross-origin request exposure, `<=0.24.2`, GHSA-67mh-4wv8-2f99).
  - **Moderate:** `glob@11.1.0` (via `vite-plugin-pwa > workbox-build`, GHSA-3g3m-2fjr-6pw4).
  - **Moderate:** `minimatch@10.2.6` (via `vite-plugin-pwa > workbox-build > glob`, GHSA-g3hv-75wg-m249).
- **Remediation:** Upgrade `firebase`, `firebase-admin`, `drizzle-kit`, and `vite-plugin-pwa` (or apply lockfile overrides) and enforce dependency vulnerability scanning in CI.

---

## 4. Cloud Readiness & Infrastructure Gaps

### CRITICAL

#### [CRIT-04] Broken Docker & GitHub Actions Builds Due to Lockfile Mismatch
- **Locations:** `Dockerfile` lines 5, 25; `.github/workflows/ci.yml` line 28
- **Finding:** Both `Dockerfile` (`COPY package.json package-lock.json* ./` + `RUN npm ci`) and `.github/workflows/ci.yml` (`run: npm ci`) require `package-lock.json`. The repository **only contains `bun.lock`** (confirmed via `ls` and `npm audit` returning `ENOLOCK`). Every Docker build and GitHub Actions CI run will fail immediately at the dependency install step.
- **Remediation:** Standardize on one lockfile/package manager across local dev, Docker, and CI (either generate and commit `package-lock.json` for Node/npm, or use `oven/bun` + `bun install --frozen-lockfile` consistently).

#### [CRIT-05] Ephemeral Container-Local Disk File Storage
- **Location:** `src/lib/storage.ts` line 6 (`path.resolve(process.cwd(), 'storage', 'private')`)
- **Finding:** All uploaded weigh-in photos, KYC documents, 3PL PODs, weighbridge tickets, and Stage 7 recycling evidence are saved to local container disk. On stateless cloud runtimes (Google Cloud Run, ECS, Kubernetes), container restarts, deployments, or horizontal scaling across replicas will permanently lose files or cause `404`/`ENOENT` errors.
- **Remediation:** Implement a pluggable `StorageProvider` interface with a Google Cloud Storage (`@google-cloud/storage`) or S3-compatible (`@aws-sdk/client-s3`) driver configured via env vars, keeping local disk strictly for local development.

### HIGH

#### [HIGH-06] Outbound Transactional Email Notifications Are Unimplemented
- **Location:** `src/lib/notifications.ts` lines 22–68; `src/components/NotificationBell.tsx` lines 133–138
- **Finding:** `dispatchNotification()` only writes to the PostgreSQL `notifications` table. Setting `RESEND_API_KEY` or `SMTP_HOST` triggers a misleading UI/API message (*"Resend API key detected; transactional email dispatch enabled"*) while **zero emails are ever sent**.
- **Remediation:** Implement real Resend REST API dispatch (and/or `nodemailer` SMTP fallback) with fire-and-forget error logging, retry/dead-letter handling, and truthful provider health reporting.

#### [HIGH-07] Static Top-Level `vite` Import Bloats Production Runtime & Unpinned `tsx` in Dockerfile
- **Locations:** `server.ts` line 6 (`import { createServer as createViteServer } from 'vite'`), `package.json` lines 15–38, `Dockerfile` lines 25, 34
- **Finding:** `server.ts` statically imports `vite` at module load time, forcing build-only tooling (`vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `vite-plugin-pwa`, `drizzle-kit`, `@types/multer`, `@types/pg`) into production `dependencies`. Furthermore, `Dockerfile` runs `RUN npm install --no-save tsx` (unpinned version fetched at container build time) instead of compiling `server.ts` to plain JS (`esbuild`/`tsc`) for production startup.
- **Remediation:** Dynamically import `vite` only inside `if (process.env.NODE_ENV !== 'production')`, move build/dev packages to `devDependencies`, and compile the backend into `dist/server.js` during `docker build` so production runs `node dist/server.js` cleanly.

#### [HIGH-08] `/api/health` Liveness Endpoint Blocked by Database Seeding Middleware
- **Location:** `server.ts` lines 206–214 (`app.use('/api', ... ensureSeeded())`) vs line 3568 (`app.get('/api/health', ...)`)
- **Finding:** Because the DB seeding middleware is mounted on `/api` *before* `/api/health`, any transient PostgreSQL connection issue causes `/api/health` to fail with `503` — causing Cloud Run / Kubernetes liveness probes to enter crash-restart loops.
- **Remediation:** Separate `/healthz` (fast process liveness, zero DB dependency) from `/readyz` / `/api/health` (readiness check verifying DB/Redis connectivity), and move DB initialization/seeding out of per-request HTTP middleware into a startup bootstrap/CLI migration step.

#### [HIGH-09] Database Pool, Cloud SQL TLS/Socket, Migrations & Graceful Shutdown Gaps
- **Locations:** `src/db/index.ts`, `src/db/drizzle.config.ts`, `server.ts` lines 3592–3637
- **Finding:**
  - `src/db/drizzle.config.ts` hardcodes `ssl: false`; `src/db/index.ts` has no `ssl` option, no `DATABASE_URL` or Cloud SQL Unix socket (`/cloudsql/...`) support, and no `idleTimeoutMillis`/`connectionTimeoutMillis`.
  - Zero SQL migration files exist (`./drizzle` is absent); production deployments cannot safely apply incremental schema migrations or rollbacks.
  - `server.ts` does not handle `SIGTERM`/`SIGINT` to drain HTTP connections and call `pool.end()`, risking aborted in-flight reservations during Cloud Run/K8s rolling deploys.
- **Remediation:** Support `DATABASE_URL` + configurable TLS (`PGSSLMODE` / CA cert) + Cloud SQL Unix socket, add connection timeouts, generate versioned Drizzle SQL migrations (`drizzle-kit generate` + `drizzle-kit migrate`), and add graceful `SIGTERM`/`SIGINT` shutdown hooks.

#### [HIGH-10] Reservation `expiresAt` TTL Never Enforced
- **Location:** `server.ts` lines 1753, 3261
- **Finding:** Reservations record `expiresAt` (+72 hours), but nothing expires stale unpicked-up reservations. Abandoned factory bookings can lock generator inventory indefinitely until manually cancelled.
- **Remediation:** Add an idempotent expiration job (or scheduled Cloud Scheduler endpoint + transactional release) that cancels `scheduled` reservations past `expiresAt` and restores `availableTons` on `waste_passports` and `waste_source_hubs`.

### MEDIUM (Architecture, Data Integrity & Product Completeness)

#### [MED-06] Weak TypeScript Strictness & Missing ESLint Configuration
- **Locations:** `tsconfig.json`, `package.json`
- **Finding:** `tsconfig.json` does not enable `"strict": true` (allowing implicit `any`, unchecked nulls across `server.ts` and React components). `npm run lint` only runs `tsc --noEmit` — there is no ESLint setup (`eslint-plugin-react-hooks`, security lint rules, unused-var checks).
- **Remediation:** Add ESLint v9 flat config (TypeScript + React Hooks) and incrementally enable `strict: true` (starting with `strictNullChecks`).

#### [MED-07] Financial/Weight Precision & Database Constraint Gaps
- **Location:** `src/db/schema.ts`
- **Finding:**
  - Currency (`pricePerTonEgp`, `totalEgp`) and weight/CO2e columns use IEEE-754 `doublePrecision` floating-point instead of `numeric(12,2)` / `numeric(12,3)`, inviting rounding drift on reconciliation.
  - `waste_source_hubs.verification_status` defaults to `'verified'` at the schema level (relying on route code to override to `'pending'`).
  - Missing SQL `CHECK` constraints (`available_tons >= 0`, `reserved_tons >= 0`, `quantity_tons > 0`), missing index on `reservations.recycling_status`, and unused legacy `file_objects.data_base64` column.
- **Remediation:** Change schema default of `waste_source_hubs.verification_status` to `'pending'`, add SQL `CHECK` constraints and missing indexes via a Drizzle migration, remove `data_base64`, and plan numeric/decimal conversion for currency/mass columns.

#### [MED-08] 3PL Vehicle Auto-Verification, Naive Carrier Assignment & Missing 3PL Onboarding
- **Locations:** `src/routes/platform-routes.ts` line 93; `server.ts` lines 1696–1701, 494–590
- **Finding:**
  - `POST /api/driver/vehicles` automatically sets `verificationStatus: 'verified'` without admin review of the environmental transport permit.
  - `POST /api/reservations` unconditionally assigns the single verified 3PL with the highest `onTimeRate`, ignoring governorate coverage, fleet capacity, or workload balance.
  - Self-registration (`POST /api/auth/register`) only supports `generator_ops` and `factory_procurement` — there is no 3PL carrier registration flow.
- **Remediation:** Default newly registered 3PL vehicles to `verificationStatus: 'pending'` with an admin approval endpoint, allow 3PL partner selection/capacity-aware dispatch, and add 3PL partner self-onboarding (starting `pending`).

#### [MED-09] Booking vs. Stage 7 Transport CO2e Formula Drift
- **Locations:** `server.ts` lines 1746, 3219 vs. `src/lib/esg-engine.ts` line 191
- **Finding:** Estimated booking-time transport CO2e uses straight-line `haversineKm`, whereas Stage 7 verified CO2e applies a `1.25x` road circuity factor (`CIRCUITY_FACTOR`), causing a consistent 25% discrepancy between booking estimates and verified freight deductions.
- **Remediation:** Centralize both estimated and verified freight calculations inside `src/lib/esg-engine.ts` using the same circuity factor (or persist actual Google Routes driving distance when available).

#### [MED-10] Google Maps Production Readiness & Marker Overlap
- **Locations:** `src/components/maps/GoogleMapsProvider.tsx` line 7; `src/components/maps/HubMarketplaceMap.tsx` lines 59–85
- **Finding:** Uses `OURO_MAP_ID = 'DEMO_MAP_ID'` (which triggers Google Maps console warnings and lacks custom vector styling in production). Additionally, `HubMarketplaceMap` places one marker per lot at `hub.lat`/`hub.lng`, so multiple lots from the same generator stack directly on top of one another and become unclickable.
- **Remediation:** Configure a real Google Cloud Map ID via `VITE_GOOGLE_MAPS_MAP_ID` (defaulting to `DEMO_MAP_ID` only in dev) and group marketplace markers by `hub.id` with a multi-lot selector in the `InfoWindow`.

#### [MED-11] Unused `@google/genai` Dependency & Capability Declaration
- **Locations:** `package.json` line 18; `metadata.json` line 10; `.env.example` line 32
- **Finding:** `@google/genai` is installed and `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` is declared, yet no file imports `@google/genai` or calls Gemini APIs.
- **Remediation:** Remove `@google/genai` (if no AI feature is planned) to shrink install/attack surface, or explicitly define a scoped Phase 2+ feature if intended.

### LOW

#### [LOW-01] Monolithic `server.ts` (3,637 lines)
- **Finding:** Over 3,600 lines of routes, helpers, auth, marketplace, logistics, ESG, and admin handlers live in one file, making maintenance, code review, and targeted unit testing difficult.
- **Remediation:** Incrementally decompose into domain routers (`src/routes/auth.ts`, `passports.ts`, `marketplace.ts`, `reservations.ts`, `esg.ts`, `admin.ts`, `storage.ts`) without changing API contracts.

#### [LOW-02] Staging Demo Accounts Bundled in Client JS Unless `VITE_APP_ENV=production` Is Injected
- **Location:** `src/components/PortalAuth.tsx` lines 27–74
- **Finding:** Hardcoded demo emails and passwords are present in client TypeScript source and only hidden at runtime via `IS_PRODUCTION_BUILD`. Anyone inspecting the built JS bundle can still read staging credentials if `VITE_APP_ENV=production` isn't passed at build time (and dead-code elimination isn't verified).
- **Remediation:** Gate demo credentials behind `import.meta.env.DEV` (or fetch from a dev-only backend endpoint when `ENABLE_DEMO_SEED=true`) so staging passwords never ship in production bundles.

#### [LOW-03] Missing Password Reset / Change Password & Approved Factory Suspension UI
- **Locations:** `src/components/PortalAuth.tsx`; `src/components/AdminCommandDashboard.tsx` line 873
- **Finding:** Users with local email/password credentials cannot reset a forgotten password or rotate their password. In Admin KYC tab, action buttons only render for `fac.kycStatus === 'pending'`, preventing admins from suspending/revoking an already-approved factory from the UI.

#### [LOW-04] Offline Queue Shared Across Browser Accounts & Cannot Queue Photos
- **Location:** `src/components/HubWorkerWorkspace.tsx` lines 58, 132–207, 293–335
- **Finding:** `ouro_worker_offline_queue_v1` in `localStorage` is not keyed by `user.id`/`hubId`, risking cross-account sync on shared industrial tablets, and photo/PDF uploads fail offline instead of buffering in IndexedDB.

#### [LOW-05] `DriverRouteMap` Routes All Active Stops to First Job's Factory
- **Location:** `src/components/Driver3plWorkspace.tsx` lines 120–142
- **Finding:** When a 3PL carrier has active jobs heading to multiple distinct recycling factories, `routeStops` appends only `activeJobs[0].factory` as the single destination.

#### [LOW-06] Workspace & Package Hygiene
- **Locations:** `package.json` (`"name": "react-example"`, `"version": "0.0.0"`), `/dev-dist/`, `/storage/private/`
- **Finding:** Default template package name/version remain; `dev-dist/` and 4 subdirectories of QA test files remain in workspace (`storage/private/`).

---

## 5. Paid Services & External Dependencies Inventory

| Service / Dependency | Where Used | Free Tier / Quota Reality | Production Cost / Risk |
| :--- | :--- | :--- | :--- |
| **Google Cloud SQL (PostgreSQL)** | `src/db/index.ts`, `server.ts` | Developer edition supports scale-to-zero / limited free tier, but production HA, automated backups, PITR, and dedicated vCPU/RAM require paid Cloud SQL or managed Postgres (Neon/Supabase/RDS). | **Paid in Production** (compute + storage + backups). |
| **Google Maps Platform (Maps JS, Places API New, Routes API)** | `GoogleMapsProvider.tsx`, `HubMarketplaceMap.tsx`, `DriverRouteMap.tsx` | Requires a **Google Cloud Billing account** attached. Monthly free usage cap applies, then per-request billing (especially Routes API traffic-aware routing and Places Autocomplete). Currently uses `DEMO_MAP_ID` and client-exposed `VITE_GOOGLE_MAPS_API_KEY`. | **Paid / Billing Required**; must enforce HTTP referrer restrictions & daily quota caps. |
| **Firebase Authentication & Admin SDK** | `src/lib/firebase.ts`, `src/lib/firebase-admin.ts`, `src/middleware/auth.ts` | Spark/Blaze free tier covers 50,000 MAU for email/Google sign-in; Identity Platform/SMS/MFA/blocking functions incur Blaze pay-as-you-go charges. | **Free Tier Generous, Blaze Required for SMS/MFA/Scale**. |
| **Cloud Object Storage (GCS / AWS S3 / Cloudflare R2)** | **Missing** (required to replace `./storage/private`) | Small free tier on GCS (5 GB/mo US) or Cloudflare R2 (10 GB/mo, zero egress). | **Paid at Scale** (storage + egress + operations). |
| **Managed Redis (Memorystore / Upstash)** | **Missing** (required for distributed rate limiting & session revocation) | Upstash offers a small free tier; GCP Memorystore for Redis has **no free tier** (~$30–$50+/mo minimum). | **Paid in Production**. |
| **Transactional Email (Resend / Postmark / SendGrid / SES)** | **Missing** (stubbed in `src/lib/notifications.ts`) | Resend free tier: 3,000 emails/mo (100/day); AWS SES: ~$0.10/1,000 emails. Custom domain DNS (SPF/DKIM/DMARC) required. | **Free Tier → Paid at Scale**. |
| **Cloud Container Runtime & CI/CD (Cloud Run / GitHub Actions)** | `Dockerfile`, `.github/workflows/ci.yml` | Cloud Run has a monthly free tier (2M requests, 180k vCPU-sec); GitHub Actions gives 2,000 free mins/mo on private repos. | **Pay-as-you-go**. |
| **Gemini API (`@google/genai`)** | Installed in `package.json`, **unused in code** | Paid beyond free-tier rate limits. | **Removable / $0 if removed**. |

---

## 6. Testing & Verification Gaps

*Verification honesty note:* During Phase 1, `tests/qa-suite.ts` was **inspected statically** (not executed) to strictly avoid mutating the live PostgreSQL database or creating orphan test records. `bun audit` and static repository checks were executed directly.

### Current Coverage (`tests/qa-suite.ts` — 14 API Integration Checks)
- Covers happy-path API lifecycle: health check, login, invalid login, unauthenticated block, pending generator/factory self-registration blocks, admin KYC/generator approvals, passport creation, reservation + atomic over-reservation prevention (`409`), idempotency replay, 3PL handoff + POD delivery (`DELIVERED` ≠ `RECYCLED`), Stage 7 recycling submission + admin verification + ESG CO2e sealing, signed private file access + cross-user denial on KYC docs, and dispute lifecycle.

### Critical Testing Gaps
1. **No Unit Test Framework (Vitest/Jest):** Zero isolated unit tests for `esg-engine.ts`, `passport-chain.ts`, `passport-qr.ts`, `auth-utils.ts`, or `security.ts` rate-limit logic.
2. **Missing Negative Security Tests for Real Vulnerabilities:** `tests/qa-suite.ts` does **not** test:
   - Null-org-ID tenant leakage (`CRIT-01`).
   - Unverified Firebase token email linking (`CRIT-02`).
   - Cross-org `fileId` attachment hijacking (`CRIT-03`).
   - `PATCH /api/factory/profile` cross-tenant overwrite (`HIGH-01`).
   - 3PL stage skipping (`scheduled` → `delivered`) and empty `qrPassportCode` bypass (`HIGH-02`).
   - Unauthenticated `weighin_photo` access (`HIGH-03`).
   - `X-Forwarded-For` rate-limit spoofing (`HIGH-04`).
   - Unauthorized dispute creation on another org's reservation (`MED-02`).
3. **No Concurrency / Race-Condition Stress Test:** Atomic `FOR UPDATE` reservation locking is tested sequentially, not with `Promise.all` parallel contention bursts.
4. **No Frontend Component or Browser E2E Tests:** Zero Playwright/Cypress browser tests verifying RTL Arabic layout, QR scanning UI, Google Maps rendering, file upload forms, or print/CSV flows.
5. **No Database Migration / Fresh-Schema Test:** CI does not spin up a clean PostgreSQL container and run migrations + seed + integration suite.
6. **Test Data Hygiene:** `tests/qa-suite.ts` creates live test users, factories, hubs, passports, and files on local disk (`storage/private/`) without tearing down uploaded files or test rows afterward (it only deactivates test users).

---

## 7. Prioritized Implementation Plan & Recommended Execution Order

To transform OURO into a hardened, cloud-deployable commercial SaaS without rewriting working functionality, execute in **5 sequential phases**:

### Phase 2 — Critical Security & Tenant Isolation Hardening (Immediate Priority)
1. **Fix all Multi-Tenant Leakage (`CRIT-01`, `HIGH-01`):** Enforce strict `role === 'platform_admin'` branching on CSV exports, ESG reports, factory reservations, marketplace reservations KPI, 3PL vehicles, and `PATCH /api/factory/profile`.
2. **Fix Firebase Account Takeover (`CRIT-02`, `MED-04`):** Enforce `decoded.email_verified === true`, protect existing `uid` bindings, and remove the hardcoded fallback admin email literal.
3. **Fix Private File Attachment Hijacking & Photo Auth (`CRIT-03`, `HIGH-03`):** Enforce `assertOwnedFile()` on all `fileId` attachments (`passports`, `receive`, `recycle`, `pod`, `kyc`) and require auth/signed URLs for `weighin_photo`.
4. **Harden 3PL State Machine & QR Verification (`HIGH-02`, `MED-02`, `MED-08`):** Require strict sequential transitions (`nextIdx === curIdx + 1`), mandatory matching `qrPassportCode` on `picked_up`, vehicle ownership validation, `FOR UPDATE` passport locking, dispute entity-party validation, and pending-by-default 3PL vehicle verification.
5. **Harden Auth Crypto, Secrets & Express Middleware (`HIGH-05`, `MED-03`):** Fail fast on missing production secrets, migrate `scryptSync` → async `scrypt`, add token revocation (`tokenVersion` + `/api/auth/logout`), enable `trust proxy`, add CORS allowlist + production CSP/HSTS, lower JSON limit to `1mb`, sanitize `X-Request-Id`.

### Phase 3 — Cloud Infrastructure, Storage, Migrations & CI/CD Repair
1. **Fix Lockfile, Docker & CI (`CRIT-04`, `HIGH-07`, `MED-05`):** Unify lockfile strategy across local/Docker/CI, compile production backend (`dist/server.js`), make `vite` dev-only dynamic import, move build tools to `devDependencies`, remove unused `@google/genai`, and resolve `bun audit` advisories.
2. **Replace Ephemeral Local Disk with Cloud Object Storage (`CRIT-05`):** Introduce `StorageProvider` abstraction with GCS/S3 adapter (fallback to local disk only in dev).
3. **Database Production Readiness (`HIGH-08`, `HIGH-09`, `MED-07`):** Add `DATABASE_URL` + TLS/Cloud SQL Unix socket support + pool timeouts, generate versioned Drizzle SQL migrations (`./drizzle`), separate `/healthz` liveness from `/readyz` + remove per-request seeding middleware, add `SIGTERM`/`SIGINT` graceful shutdown, and harden schema defaults/constraints/indexes.

### Phase 4 — Missing Production Integrations & Audit Chain Hardening
1. **Distributed Redis Rate Limiting (`HIGH-04`):** Implement `RedisRateLimitStore` using `REDIS_URL` with clean fallback only in single-instance dev.
2. **Real Transactional Email Dispatch (`HIGH-06`):** Implement Resend API + SMTP fallback in `src/lib/notifications.ts` with honest health status reporting.
3. **Reservation TTL Enforcement (`HIGH-10`):** Add automated expiry worker/endpoint releasing expired `scheduled` reservations transactionally.
4. **Audit Chain & ESG Alignment (`MED-01`, `MED-09`):** Include `createdAt`, `summaryAr`, `lat`, `lng` in canonical SHA-256 event hashing, add PostgreSQL immutability triggers on `passport_events` and `admin_audit_logs`, and unify booking vs. Stage 7 transport CO2e circuity formula.

### Phase 5 — Workflow Polish, Code Quality & Comprehensive QA Automation
1. **Frontend & Domain Refinements (`MED-10`, `LOW-02`–`LOW-05`):** Real `VITE_GOOGLE_MAPS_MAP_ID`, hub-grouped marketplace map markers, multi-factory `DriverRouteMap` routing, 3PL self-onboarding + admin factory suspension UI, password reset/change flow, per-user offline queue scoping, and dev-only demo credential gating.
2. **Modularize `server.ts` & Enable Strict Tooling (`MED-06`, `LOW-01`, `LOW-06`):** Split `server.ts` into domain route modules, configure ESLint + incremental `tsconfig` strictness, clean package metadata and workspace artifacts.
3. **Automated Test Suite Expansion:** Add Vitest unit tests (ESG, hash chain, auth, rate limiter), parallel concurrency reservation test, negative security regression tests covering every `CRIT`/`HIGH` finding above, clean DB migration CI job, and Playwright E2E smoke tests.

---

**Audit Complete — Awaiting User Approval:** No source code, schema, or infrastructure files have been modified during Phase 1. Please review this report and confirm whether you would like to proceed starting with **Phase 2 (Critical Security & Tenant Isolation Hardening)** or adjust priorities.

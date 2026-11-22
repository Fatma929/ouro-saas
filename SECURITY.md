# OURO Security Architecture & Hardening Guide

This document defines the active security controls, role-based access boundaries, data isolation guarantees, upload protections, environment validation rules, and dependency risk disclosures for the **OURO Digital Waste Management SaaS Platform**.

---

## 1. Authentication & Session Lifecycle

OURO supports two server-verified authentication mechanisms via `Authorization: Bearer <token>` on all protected `/api/*` endpoints (query-parameter tokens such as `?token=` are never accepted):

1. **Firebase ID Tokens (`firebase-admin`):**
   - Verified server-side using `adminAuth.verifyIdToken(token, true)` with `checkRevoked = true`, ensuring revoked or disabled Firebase sessions are rejected immediately (`401 Unauthorized`).
   - Account linking (`evaluateFirebaseLinkPolicy` in `src/middleware/auth.ts`) enforces strict ownership rules:
     - Existing accounts can only be linked to a Firebase UID when `decoded.email_verified === true`.
     - If an existing user is already bound to a Firebase UID (non-`ouro-*`), a different Firebase UID cannot hijack or overwrite that binding (`403 Forbidden`).
     - Bootstrap platform administrator auto-promotion requires `decoded.email_verified === true` and an explicit `OURO_BOOTSTRAP_ADMIN_EMAIL` environment variable in production (zero hardcoded personal admin emails in production).
   - Portable cloud initialization (`src/lib/firebase-admin.ts`) supports `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT_JSON` (raw or base64 JSON) for AWS, Docker, or GCP deployments.

2. **Server-Signed HMAC Role Sessions (`ouro.<payload>.<signature>`):**
   - Signed with HMAC-SHA256 using `OURO_SESSION_SECRET` (minimum 32 characters enforced at boot in `NODE_ENV=production`) and verified with constant-time comparison (`crypto.timingSafeEqual`).
   - Password hashing uses salted `crypto.scrypt` via non-blocking async helpers (`hashPasswordAsync` / `verifyPasswordAsync`) so login and registration requests never block the Node.js event loop.
   - Every token includes a unique token identifier (`jti`, 128 bits of randomness) and 12-hour expiry (`exp`).
   - **Immediate Server-Side Logout & Revocation:** `POST /api/auth/logout` revokes the caller's token by writing `auth:revoked:<jti>` into the configured cache provider (`memory` in local dev, `redis` across replicas in production) with TTL matching the token's remaining lifetime. Revoked tokens are immediately rejected (`401`) on subsequent API calls.
   - **Immediate User Deactivation:** Every authenticated request loads the user record from PostgreSQL and checks `user.isActive === true`. Deactivating a user immediately blocks all further API calls (`403`) even if they still hold an unexpired token.
   - **Zero Browser Storage of Auth Tokens:** Bearer tokens live strictly in React in-memory state (`src/lib/api.ts`), never in `localStorage` or `sessionStorage`.

---

## 2. Role-Based Access Control (RBAC) & Organization Isolation

Every protected endpoint enforces server-side role verification (`requireRole(...)`) and strict organization-level ownership checks. Users without an assigned organization record (`hubId`, `factoryId`, or `logisticsProviderId`) are never permitted to fall through into unscoped multi-tenant queries.

| Role | Organization Scope | Permitted Operations | Strictly Blocked |
|---|---|---|---|
| `generator_ops` | Single `waste_source_hubs` (`hubId`) | Create/edit/cancel waste passports for own verified hub; view own hub transactions & CSV export; view own passports; open disputes on own passports/reservations; upload weigh-in photos & supporting docs. | Listing before Admin hub verification (`403`); viewing/editing/cancelling other hubs' lots; browsing buyer marketplace lots (`403`); mutating reservations or factory profiles; admin routes. |
| `factory_procurement` | Single `recycling_factories` (`factoryId`) | Browse approved marketplace lots; reserve stock atomically (requires KYC `approved`); update own factory profile; log Stage 6 weighbridge intake; submit Stage 7 recycling evidence; view own ESG report & CSV; open disputes on own reservations. | Reserving before KYC approval (`403`); viewing closed passports they did not reserve (`403`); self-approving Stage 7 `RECYCLED` status; modifying other factories' profiles (`403`); viewing/managing 3PL fleets. |
| `driver_3pl` | Single `logistics_providers` (`logisticsProviderId`) | Manage vehicles for own carrier; view assigned shipments; advance shipment stages strictly sequentially (`scheduled -> accepted -> en_route -> arrived -> picked_up -> delivered`) with mandatory QR passport scan at pickup and verified carrier-owned active vehicle; upload POD evidence; open disputes on assigned shipments. | Accessing other carriers' vehicles or shipments (`403`); skipping stages (`409`); picking up without QR passport verification (`400`); assigning another carrier's vehicle (`403`); reserving marketplace lots or accessing ESG reports. |
| `platform_admin` | Platform-wide governance | Approve/reject Factory KYC, Waste Generator hub verification, 3PL carrier verification, and Stage 7 Recycling Verification (all require mandatory audit reason written to `admin_audit_logs`); manage emission factors; resolve disputes; activate/deactivate users; view system health. | Bypassing audit logging on governance actions (all state changes log `actorEmail` + `reason`). |

### Key Multi-Tenant & Object-Level Protections
- **Passports (`GET /api/passports/:codeOrId`):** Full timeline and reservation details are visible only to `platform_admin`, the owning generator hub, participating buyer factories, and assigned 3PL carriers. Prospective KYC-approved buyer factories viewing an active marketplace lot receive a redacted Stages 1–3 preview with private reservation records omitted.
- **Notifications:** Queries and mutations strictly match `userId = me OR (userId IS NULL AND targetRole = myRole)`. Same-role users in other organizations cannot view or acknowledge another user's private notifications.
- **Disputes (`POST /api/disputes`):** Verifies that referenced `reservationId` and `passportId` exist and that the caller's organization is a legitimate party to that transaction (`403` otherwise).
- **Private File Attachment Guard (`assertFileAttachable`):** Whenever a route links a `file_objects` ID (`photoFileId`, `supportingDocFileId`, `podFileId`, `weighbridgeFileId`, `recyclingEvidenceFileId`), the server verifies inside the transaction that the file exists, matches the expected `purpose`, and belongs to the caller or caller's organization (`403` on cross-organization attachment attempts).
- **Factory Profile Updates (`PATCH /api/factory/profile`):** `factory_procurement` users can only update their own `user.factoryId`; `req.body.factoryId` targeting is restricted strictly to `platform_admin`.

---

## 3. File Upload, Storage & MIME Spoofing Protections

- **Private-Only Storage:** Uploaded files are never stored in `public/` or served statically. Storage uses the cloud-agnostic adapter (`local` private directory, private `s3` bucket, or private `gcs` bucket).
- **Strict Magic-Byte Validation (`src/lib/storage.ts`):** Every upload validates both declared MIME type and raw binary file signature (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF...WEBP`, PDF `%PDF-`) and enforces maximum payload size (`STORAGE_MAX_FILE_BYTES`, default 8 MB). Polyglot or spoofed files (e.g., HTML/JS disguised as `.jpg` or `.pdf`) are rejected with `400`.
- **Authenticated Access & Short-Lived Signed URLs:** `GET /api/storage/:id` enforces authentication and ACL checks (`canUserAccessFileWithLinks`) for **all** file purposes — including `weighin_photo` — or requires a valid short-lived HMAC `?sig=` token (`OURO_FILE_SIGN_SECRET`, 5-minute TTL) scoped to a specific file ID and requesting user ID.
- **Referenced-File Deletion Guard:** `DELETE /api/storage/:id` blocks deletion (`409`) if the file is actively referenced by any passport photo, supporting document, passport event, POD, weighbridge ticket, or recycling evidence record.
- **Safe Download Headers:** Served files always send `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, and `Content-Disposition: inline; filename="<sanitized>"`.

---

## 4. Web Application & API Security Controls

| Threat Vector | Control Implemented |
|---|---|
| **SQL Injection** | 100% Drizzle ORM parameterized queries across `server.ts`, `src/routes/`, and `src/db/`. Zero raw string-interpolated SQL (`sql.raw` is not used anywhere). |
| **XSS (Cross-Site Scripting)** | React automatic JSX escaping; zero `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, or `document.write`; strict `Content-Security-Policy` in production; JSON API responses only. |
| **CSV Formula Injection** | All CSV exports (`/api/generator/transactions.csv`, `/api/esg/export.csv`) pass every cell through `escapeCsvCell()`, prefixing leading `=`, `+`, `-`, `@`, `\t`, or `\r` characters with a single quote (`'`). |
| **CORS & Cross-Origin Forgery (CSRF)** | Auth relies on explicit `Authorization: Bearer` headers (not ambient cookies), eliminating classic cookie CSRF. Additionally, `createCorsMiddleware` enforces an explicit `ALLOWED_ORIGINS` / same-origin allowlist (never `*`), sets `Vary: Origin`, rejects disallowed preflight requests (`403`), and rejects disallowed cross-origin state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE` -> `403`). |
| **Security Headers** | `X-Powered-By` disabled; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` locking down microphone/payment/usb; `X-Permitted-Cross-Domain-Policies: none`; `X-Request-Id` correlation header on every response; production `Strict-Transport-Security` (`max-age=31536000; includeSubDomains`) and `Content-Security-Policy`. |
| **Rate Limiting & Payload Bounds** | JSON body limit tightened to `1mb`; tiered rate limiters backed by `getCacheProvider()` (in-memory in local dev, atomic Redis Lua fixed-window in production): general API (`300 req/min`), auth (`20 req/15min`), write mutations (`90 req/min`), uploads (`25 req/5min`), and reservation booking (`30 req/min`). Multi-instance production refuses to boot without Redis. |
| **Tamper-Evident Traceability** | Every Digital Waste Passport stage appends a SHA-256 chained event (`prevHash -> eventHash`), verifiable via `GET /api/passports/:codeOrId/verify-chain`. |

---

## 5. Secrets Management & Environment Validation

- **Frontend Secret Isolation:** Audited via static scan across `src/` and `vite.config.ts`. The browser bundle reads only two public `VITE_*` variables (`VITE_APP_ENV` and HTTP-referrer-restricted `VITE_GOOGLE_MAPS_API_KEY`). Zero database credentials, signing secrets, Firebase service accounts, or cloud storage keys are exposed to the client.
- **Startup Environment Validation (`validateEnvironmentConfig` in `src/infra/config.ts`):**
  - In `NODE_ENV=production`, server startup **fails fast** if `OURO_SESSION_SECRET` or `OURO_FILE_SIGN_SECRET` is missing or shorter than 32 characters, if database connectivity variables are absent, or if `DEPLOYMENT_TOPOLOGY=multi-instance` lacks a valid `REDIS_URL`.
  - In `NODE_ENV=development`, missing optional hardening variables emit structured warnings without blocking local development.
- **Environment Templates:** Provided for all lifecycle stages with zero real credentials:
  - `.env.example` (shared reference)
  - `.env.development.template`
  - `.env.staging.template`
  - `.env.production.template`

---

## 6. Dependency Vulnerability Audit (`bun audit`)

Audited against the workspace lockfile (`bun.lock`) during Phase 3. Observed transitive advisories (5 total: 1 High, 3 Moderate, 1 Low):

| Package | Version | Severity | Dependency Path | Scope & Mitigation |
|---|---|---|---|---|
| `@grpc/grpc-js` | `1.9.16` | High + Low | `firebase` / `firebase-admin` (transitive) | Direct dependencies are already on current majors (`firebase@^13.4.0`, `firebase-admin@^14.5.1`). OURO does not expose gRPC endpoints to untrusted clients; monitor upstream `firebase-admin` patch releases and enforce CI audit checks. |
| `esbuild` | `0.18.20` | Moderate | `drizzle-kit` (CLI/dev tooling only) | Not bundled into runtime server or frontend builds; dev server is never exposed publicly. |
| `glob` | `11.1.0` | Moderate | `vite-plugin-pwa -> workbox-build` (build-time only) | Runs only during `vite build` asset bundling; zero runtime exposure in production server or browser. |
| `minimatch` | `10.2.6` | Moderate | `vite-plugin-pwa -> workbox-build` (build-time only) | Build-time PWA precache matching only; zero runtime exposure to user input. |

CI workflow (`.github/workflows/ci.yml`) runs automated dependency auditing (`npm audit --omit=dev --audit-level=high`) on every build to catch newly disclosed runtime vulnerabilities before deployment.

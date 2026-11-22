# OURO Platform Hardening & Verification Walkthrough

## Overview
This walkthrough documents the security hardening, workflow governance upgrades, scientific ESG integrity refinements, UI/UX RTL improvements, operational readiness files, and live end-to-end automated verification executed against the OURO Digital Waste Management SaaS platform (`server.ts`, Cloud SQL PostgreSQL via Drizzle ORM, React 19 + TypeScript + Vite SPA).

---

# Security Summary

### 1. Eliminated Automatic Approval for Newly Registered Waste Generators
- **Finding:** Self-registered Waste Generators (`POST /api/auth/register-generator`) previously received `verificationStatus = 'verified'` immediately upon signup, allowing unverified organizations to publish marketplace listings.
- **Safeguard Implemented:** New generator accounts now start with `verificationStatus = 'pending'` and notify Platform Admins. `POST /api/passports` enforces a server-side verification gate (`403 GENERATOR_VERIFICATION_PENDING`) until a Platform Admin approves the organization via `PATCH /api/admin/hubs/:id/verify` with a mandatory audit note logged in `admin_audit_logs`.

### 2. Enforced Object-Level Authorization on Digital Waste Passports
- **Finding:** `GET /api/passports/:codeOrId` previously allowed any authenticated user to inspect full passport timelines and reservation records by code or ID.
- **Safeguard Implemented:** Passport access is strictly scoped server-side to Platform Admins, the owning Waste Generator, participating buyer Recycling Factories, and the assigned 3PL Logistics Carrier. Prospective buyer factories inspecting active marketplace listings (`availableTons >= 0.5`, non-cancelled) receive a redacted preview restricted to Stages 1–3 with private reservations hidden. Unrelated generators and non-participating factories on closed lots receive `403 Forbidden`.

### 3. Closed Cross-Organization Notification Leakage
- **Finding:** Notification queries and read mutations previously matched `userId = me OR targetRole = myRole`, enabling users sharing a role across different organizations to view or modify another user's private notifications.
- **Safeguard Implemented:** Notification retrieval (`GET /api/notifications`), individual read acknowledgement (`PATCH /api/notifications/:id/read`), and bulk read (`POST /api/notifications/read-all`) now strictly scope to `userId = me OR (userId IS NULL AND targetRole = myRole)`, ensuring user-specific notifications are never exposed to same-role peers in other organizations.

### 4. Tightened Private Supporting Document Access
- **Finding:** Passport supporting documents could previously be accessed by any user with the `factory_procurement` role regardless of KYC status or lot availability.
- **Safeguard Implemented:** `canUserAccessFileWithLinks` now permits non-owning factory access to `supporting_doc` files only for KYC-approved factories inspecting an active lot or a lot they reserved, while private KYC files remain restricted to the owning factory and Platform Admins, accessed exclusively through short-lived HMAC-signed URLs (`POST /api/storage/:id/sign`) after magic-byte MIME verification.

### 5. Independent 2-Step Stage 7 Recycling Verification
- **Finding:** Buyer Recycling Factories could previously self-certify Stage 7 `RECYCLED` status and mint verified CO2e credits in a single request without independent review.
- **Safeguard Implemented:** Factory submissions (`POST /api/reservations/:id/recycle`) validate mass balance (`recovered + residual + loss <= delivered`), persist `recyclingStatus = 'submitted_for_verification'`, keep the passport at Stage 6 `DELIVERED` with `0` verified CO2e, and queue the shipment for independent review. A Platform Admin/Verifier must audit the signed weighbridge ticket and recycling evidence via `POST /api/admin/reservations/:id/verify-recycling` (`approved` or `rejected` with mandatory audit note) before sealing Stage 7 `RECYCLED` and including net CO2e in verified ESG totals.

### 6. Production Seed Guard, Correlation IDs & Distributed Rate-Limit Readiness
- **Production Seed Guard:** Reference emission factors (`seedReferenceEmissionFactors`) seed in all environments, whereas demo credentials (`OuroDemo#2026`), sample organizations, and sample passports are automatically skipped when `NODE_ENV=production` unless `ALLOW_PILOT_SEED=true` is explicitly set in staging.
- **Configurable Bootstrap Admin & Startup Checks:** Bootstrap admin identity reads from `OURO_BOOTSTRAP_ADMIN_EMAIL`, and production startups log warnings if `OURO_SESSION_SECRET` or `OURO_FILE_SIGN_SECRET` are unset.
- **Observability & Scale Hooks:** Every API response includes an `X-Request-Id` correlation header, `GET /api/ready` verifies live PostgreSQL connectivity (`SELECT 1`), and `createRateLimiter` supports a pluggable `RateLimitStore` interface for connecting `REDIS_URL` across multi-replica deployments.

### 7. Dependency Audit Disclosure
- Running `bun audit` identified 5 transitive advisories in upstream packages:
  - 1 high and 1 low in `@grpc/grpc-js@1.9.16` (pulled transitively by `firebase` / `firebase-admin`).
  - 3 moderate in dev/build tooling (`esbuild` inside `drizzle-kit`, and `glob` / `minimatch` inside `vite-plugin-pwa`).
- None are exposed directly to unauthenticated runtime inputs in the pilot deployment, and CI (`.github/workflows/ci.yml`) tracks production advisories (`npm audit --omit=dev --audit-level=high`) for upstream upgrades.

---

## PoC Verification

All 14 automated end-to-end and unit test suites in `tests/qa-suite.ts` were executed live against the Express API (`http://localhost:3000`) backed by Cloud SQL PostgreSQL (`npx tsx tests/qa-suite.ts`). **Result: 14 / 14 passed (0 failures).**

| # | Test Suite | Observed Result |
|---|---|---|
| 1 | Auth, RBAC isolation, iframe-safe security headers & immediate deactivated-user blocking | **PASS** (196ms) |
| 2 | Private storage magic-byte spoofing rejection, zero `?token=` bypass & 5-min signed URL ACLs | **PASS** (95ms) |
| 3 | Cross-organization isolation across Waste Generators & 3PL Carriers | **PASS** (152ms) |
| 4 | Waste listing create, edit, CSV formula-injection neutralization (`'=CMD...`), and cancel lifecycle | **PASS** (235ms) |
| 5 | Concurrency race test (4 simultaneous 2t bookings on 5t lot → strictly 2 succeed `201`, 2 conflict `409`) | **PASS** (442ms) |
| 6 | `Idempotency-Key` deduplication & atomic cancellation stock restoration | **PASS** (320ms) |
| 7 | External 3PL vehicle registration, QR handoff mismatch rejection (`400`) & Stage 6 `DELIVERED != RECYCLED` (`0` verified CO2e) | **PASS** (625ms) |
| 8 | Stage 7 weighbridge intake, mass-balance overclaim guard (`400`), 2-step independent verification (factory submit stays Stage 6 → admin reject → factory resubmit → admin approve seals Stage 7 `RECYCLED` & verified net CO2e), ESG report separation & limitations disclosure | **PASS** (664ms) |
| 9 | SHA-256 tamper-evident hash chain verification across complete 7-stage passport | **PASS** (30ms) |
| 10 | Dispute open/resolve workflow, live emission factor update/restore, notifications & `/api/admin/system-health` | **PASS** (219ms) |
| 11 | New Waste Generator self-registration starts `pending`, blocked (`403`) from listing until Admin verifies (`PATCH /api/admin/hubs/:id/verify`), then succeeds (`201`) | **PASS** (378ms) |
| 12 | Object-level passport ACLs: unrelated generator blocked (`403`), prospective buyer gets redacted Stages 1–3 preview (`0` private reservations) on active lot and `403` on closed Stage 7 passport, authorized parties receive `200` | **PASS** (210ms) |
| 13 | User-level notification isolation: same-role user in different organization cannot view or mark (`403`) another user's private notification | **PASS** (89ms) |
| 14 | ESG engine unit assertions (`1.25x` road circuity, `verified` vs `calculated` vs `estimated` tiers), live DB readiness probe (`GET /api/ready` → `200 { ready: true }`) & `X-Request-Id` header | **PASS** (9ms) |

### Readiness Classification
**Field Pilot Ready** — Ready for live supervised B2B pilot deployments with real Cloud SQL PostgreSQL, real RBAC/KYC governance, tamper-evident 7-stage Digital Waste Passports, and 2-step ESG verification. Three external cloud infrastructure items remain before full multi-region commercial production:
1. Swap the `./storage/private` local disk adapter in `src/lib/storage.ts` to a private Google Cloud Storage (GCS) or S3 bucket with KMS encryption for multi-replica stateless scaling.
2. Connect a Redis adapter (`REDIS_URL`) to the `RateLimitStore` interface in `src/middleware/security.ts` for distributed rate limiting across multiple Cloud Run replicas.
3. Configure verified domain DKIM/SPF credentials for `RESEND_API_KEY` or SMTP and upgrade upstream transitive packages (`firebase-admin` / `vite-plugin-pwa`) as patched majors release.

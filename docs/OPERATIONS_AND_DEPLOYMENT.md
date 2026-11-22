# OURO — Operations, Security & Production Deployment Runbook

## 1. Architecture Overview
- **Frontend:** React 19 + TypeScript + Tailwind CSS v4 + Vite SPA + PWA (`manifest.webmanifest`, service worker).
- **Backend API:** Node.js + Express (`server.ts`, `src/routes/platform-routes.ts`) serving both `/api/*` and the compiled SPA on port `3000`.
- **Database:** Managed PostgreSQL (Google Cloud SQL) accessed via Drizzle ORM (`src/db/schema.ts`, `src/db/index.ts`).
- **Authentication & RBAC:** Firebase Authentication + HMAC-signed server session tokens with server-side `users.isActive` enforcement and strict role + organization isolation (`generator_ops`, `factory_procurement`, `driver_3pl`, `platform_admin`).
- **Private Document Storage:** Confined private disk storage (`./storage/private`) with magic-byte MIME verification, SHA-256 digests, object-level ACL checks, and 5-minute HMAC signed download tokens (`POST /api/storage/:id/sign`).
- **Digital Waste Passport Integrity:** Every `passport_events` row chains `prev_hash` → `event_hash` via SHA-256 and is verified on `GET /api/passports/:codeOrId`.
- **Maps & Routing:** Google Maps Platform (`@vis.gl/react-google-maps`, Places API New, Routes API).

## 2. Non-Negotiable Operational Invariants
1. **Strict 3-Status Lifecycle (`LISTED` → `DELIVERED` → `RECYCLED`):**
   - Newly self-registered Waste Generators start in `verificationStatus = 'pending'` and cannot publish marketplace listings until approved by a Platform Admin (`PATCH /api/admin/hubs/:id/verify`).
   - Creating a lot (`POST /api/passports`) sets `lifecycleStatus = 'LISTED'`.
   - 3PL delivery (`PATCH /api/reservations/:id/status` with `nextStatus = 'delivered'`) advances to Stage 6 (`DELIVERED`) with `verifiedCo2eTons = 0`.
   - **Independent 2-Step Stage 7 Verification:** When a Recycling Factory submits recovered/residual/loss mass-balance evidence (`POST /api/reservations/:id/recycle`), the reservation enters `recyclingStatus = 'submitted_for_verification'` while the passport remains at Stage 6 (`DELIVERED`) with `0` verified CO2e. An independent Platform Admin/Verifier must review the signed weighbridge ticket and recycling certificate via `POST /api/admin/reservations/:id/verify-recycling` (`approved` or `rejected` with mandatory audit note) before the passport seals at Stage 7 (`RECYCLED`) and enters verified ESG totals.
2. **Asset-Light 3PL Model:** OURO does not own trucks or transport waste; external certified 3PL carriers manage their own fleet registry and physical haulage.
3. **Concurrency Safety:** `POST /api/reservations` acquires PostgreSQL `SELECT ... FOR UPDATE` row locks on `waste_passports` and `waste_source_hubs`, performs a conditional stock decrement, and supports `Idempotency-Key` deduplication.
4. **Scientific ESG Disclosures:** Net CO2e calculations apply a `1.25x` road circuity factor to straight-line distances, require both weighbridge and recycling evidence plus independent verifier sign-off for `'verified'` confidence, and disclose proxy emission-factor limitations on all ESG reports and certificates.

## 3. Environment Configuration
Set all secrets in your secret manager (never commit `.env`):
- **Required for DB:** `SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD` (and `SQL_ADMIN_USER` / `SQL_ADMIN_PASSWORD` for schema updates).
- **Required for Security in Production:**
  - `NODE_ENV=production` (blocks demo account and sample data seeding automatically unless `ALLOW_PILOT_SEED=true` is explicitly set in staging)
  - `VITE_APP_ENV=production` (hides staging quick-login helpers in the frontend bundle)
  - `OURO_SESSION_SECRET` (random 64-byte hex string)
  - `OURO_FILE_SIGN_SECRET` (random 64-byte hex string)
  - `OURO_BOOTSTRAP_ADMIN_EMAIL` (optional initial platform admin identity)
- **Required for Maps:** `VITE_GOOGLE_MAPS_API_KEY` (restricted by HTTP referrer in Google Cloud Console).
- **Optional Scale & Email Integrations:**
  - `REDIS_URL` (connect a Redis adapter implementing `RateLimitStore` in `src/middleware/security.ts` before scaling beyond 1 stateless replica).
  - `RESEND_API_KEY` or `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`. If unset, OURO operates honestly in in-app notification mode and surfaces email provider status in `/api/admin/system-health`.

## 4. Build, CI/CD, Schema Sync & Deployment
- **CI Pipeline:** `.github/workflows/ci.yml` runs on pushes/PRs to `main` and `staging`: `npm ci` → `npm run lint` → `VITE_APP_ENV=production npm run build` → `npm audit --omit=dev --audit-level=high`.
- **Container Deployment (Cloud Run / Kubernetes):** Build from `/Dockerfile` (multi-stage Node 22 Alpine, non-root `ouro` user, built-in `HEALTHCHECK` against `/api/ready`).
```bash
# Local production verification
npm ci
npm run lint
VITE_APP_ENV=production npm run build
NODE_ENV=production npm start
```
- **Probes & Correlation:**
  - Liveness probe: `GET /api/health` (fast process check).
  - Readiness probe: `GET /api/ready` (executes live `SELECT 1` against Cloud SQL PostgreSQL; returns `200` when ready or `503` if DB is unreachable).
  - Every API response carries an `X-Request-Id` header for log correlation.
- **Database Migrations:** Schema changes in `src/db/schema.ts` are applied via Drizzle Kit (`src/db/drizzle.config.ts`). On startup, `seedReferenceEmissionFactors()` ensures reference emission factors exist in all environments, while demo organizations and demo credentials are skipped in production (`NODE_ENV=production` and `ALLOW_PILOT_SEED !== 'true'`).

## 5. Monitoring, Alerting & Disaster Recovery
- **Alerting Thresholds (Recommended Cloud Monitoring / Datadog):**
  - Readiness probe `/api/ready` failing > 2 consecutive checks (1 minute) → P1 page.
  - HTTP `5xx` error rate > 1% over 5 minutes → P1 page.
  - p95 API latency > 1200ms on `/api/reservations` or `/api/passports` → P2 alert.
  - Cloud SQL connection utilization > 80% or storage > 85% → P2 alert.
- **PostgreSQL (Cloud SQL):** Enable automated daily backups + Point-in-Time Recovery (PITR) binlogs in GCP Cloud SQL. Test quarterly restores into a staging instance and verify `passport_events` SHA-256 chain integrity after restore.
- **Uploaded Evidence Files:** In single-container pilot deployments, files live in `./storage/private` with SHA-256 digests stored in `file_objects`. Before scaling horizontally to multiple stateless replicas, swap `src/lib/storage.ts` persistence calls to a private Google Cloud Storage (GCS) or S3 bucket with CMEK/KMS encryption while preserving the exact `file_objects` metadata, ACL checks, and signed URL endpoints.

## 6. Readiness Classification: Field Pilot Ready vs. Full Multi-Region Production
| Capability | Current Build (Field Pilot Ready) | Remaining External Cloud Step for Full Production |
|---|---|---|
| Core B2B Waste → 3PL → Recycler → Verifier → ESG Workflows | **YES** — Live PostgreSQL, generator approval gate, strict 3-status lifecycle, 2-step Stage 7 independent verification, mass-balance reconciliation | Optional ERP/SAP webhook exports & multi-leg consolidation |
| Concurrency & Double-Booking Prevention | **YES** — `SELECT ... FOR UPDATE`, conditional update, `Idempotency-Key` | Connect `REDIS_URL` to `RateLimitStore` for multi-replica Cloud Run rate limiting |
| Traceability & Tamper Evidence | **YES** — SHA-256 chained `passport_events`, live chain verification, object-level passport & notification ACLs | Optional periodic root-hash anchoring to WORM audit storage |
| Private Document Security | **YES** — Private disk, magic-byte validation, org + active-lot ACLs, 5-min signed URLs | Swap `./storage/private` adapter to private GCS/S3 bucket + KMS & AV scan |
| Notifications | **YES (In-App)** — User-scoped DB notifications + honest email status | Provision verified domain DKIM/SPF for Resend or SMTP |
| Pilot vs Live Data & Supply Chain | **YES** — `NODE_ENV=production` seed guard blocks demo credentials/records | Upgrade upstream transitive packages (`firebase-admin` / `vite-plugin-pwa`) as patched majors release |

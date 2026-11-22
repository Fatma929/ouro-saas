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
   - Creating a lot (`POST /api/passports`) sets `lifecycleStatus = 'LISTED'`.
   - 3PL delivery (`PATCH /api/reservations/:id/status` with `nextStatus = 'delivered'`) advances to Stage 6 (`DELIVERED`) with `verifiedCo2eTons = 0`.
   - Only verified recycling outcomes (`POST /api/reservations/:id/recycle`) with recovered/residual/loss mass-balance validation advance to Stage 7 (`RECYCLED`) and generate verified net CO2e claims.
2. **Asset-Light 3PL Model:** OURO does not own trucks or transport waste; external certified 3PL carriers manage their own fleet registry and physical haulage.
3. **Concurrency Safety:** `POST /api/reservations` acquires PostgreSQL `SELECT ... FOR UPDATE` row locks on `waste_passports` and `waste_source_hubs`, performs a conditional stock decrement, and supports `Idempotency-Key` deduplication.

## 3. Environment Configuration
Set all secrets in your secret manager (never commit `.env`):
- **Required for DB:** `SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD` (and `SQL_ADMIN_USER` / `SQL_ADMIN_PASSWORD` for schema updates).
- **Required for Security in Production:**
  - `NODE_ENV=production`
  - `VITE_APP_ENV=production` (hides staging quick-login buttons)
  - `OURO_SESSION_SECRET` (random 64-byte hex string)
  - `OURO_FILE_SIGN_SECRET` (random 64-byte hex string)
- **Required for Maps:** `VITE_GOOGLE_MAPS_API_KEY` (restricted by HTTP referrer in Google Cloud Console).
- **Optional Transactional Email:** `RESEND_API_KEY` or `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`. If unset, OURO operates honestly in in-app notification mode and surfaces email provider status in `/api/admin/system-health`.

## 4. Build, Schema Sync & Deployment
```bash
# Install dependencies
npm ci

# Build frontend assets
npm run build

# Start production server (serves API + dist/)
npm start
```
Schema changes in `src/db/schema.ts` are applied via Drizzle Kit (`src/db/drizzle.config.ts`). Seed backfill (`ensurePilotEnhancementsBackfilled`) is idempotent and safe to run on startup.

## 5. Backups & Disaster Recovery
- **PostgreSQL (Cloud SQL):** Enable automated daily backups + Point-in-Time Recovery (PITR) binlogs in GCP Cloud SQL. Test quarterly restores into a staging instance.
- **Uploaded Evidence Files:** In single-container pilot deployments, files live in `./storage/private` with SHA-256 digests stored in `file_objects`. Before scaling horizontally to multiple stateless replicas, swap `src/lib/storage.ts` persistence calls to Google Cloud Storage (GCS) or S3 while preserving the exact `file_objects` metadata, ACL checks, and signed URL endpoints.

## 6. Pilot Readiness vs. Full Production Readiness Assessment
| Capability | Pilot Ready (Current Build) | Full Enterprise Production Next Step |
|---|---|---|
| Core B2B Waste → 3PL → Recycler → ESG Workflows | **YES** — Live PostgreSQL, strict 3-status lifecycle, mass-balance reconciliation | Add multi-leg consolidation & ERP/SAP webhooks |
| Concurrency & Double-Booking Prevention | **YES** — `SELECT ... FOR UPDATE`, conditional update, `Idempotency-Key` | Add Redis distributed rate limiting for multi-instance scale |
| Traceability & Tamper Evidence | **YES** — SHA-256 chained `passport_events`, live chain verification | Optional periodic anchoring of root hash to external WORM audit bucket |
| Private Document Security | **YES** — Private disk, magic-byte validation, org ACLs, 5-min signed URLs | Migrate `./storage/private` adapter to Cloud Storage (GCS/S3) + antivirus scan |
| Notifications | **YES (In-App)** — Live DB notifications + honest email status | Provision Resend/SMTP domain DKIM/SPF for external email alerts |
| Pilot vs Live Data | **YES** — Explicit `isSampleData` tagging & admin disclosure banner | Run clean production DB without pilot seed records (`SKIP_PILOT_SEED=true`) |

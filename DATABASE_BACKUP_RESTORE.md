# OURO Database Integrity, Backup, Restore & Point-in-Time Recovery (PITR) Guide

This document defines the verified PostgreSQL schema governance, transaction safety guarantees, logical backup and restoration procedures, and future Point-in-Time Recovery (PITR) configuration for the **OURO Digital Waste Management SaaS Platform**.

---

## 1. Verified Schema & Integrity Baseline

Database engine: **PostgreSQL** managed via **Drizzle ORM** (`src/db/schema.ts`, `src/db/drizzle.config.ts`) and pooled via `pg.Pool` (`src/infra/database.ts`).

### Live Schema Inventory (Verified against PostgreSQL `pg_constraint` & `pg_indexes`)
- **14 tables** in schema `public`:
  `admin_audit_logs`, `disputes`, `emission_factors`, `file_objects`, `idempotency_keys`, `logistics_providers`, `logistics_vehicles`, `notifications`, `passport_events`, `recycling_factories`, `reservations`, `users`, `waste_passports`, `waste_source_hubs`.
- **23 active foreign key constraints** enforcing referential integrity across users, hubs, factories, 3PL carriers, vehicles, passports, events, reservations, disputes, notifications, and private file objects.
- **42 indexes** (14 primary keys, 11 unique constraints/indexes including `passport_code`, `reservation_code`, `idempotency_keys.key`, `users.uid`, `users.email`, and 17 secondary B-tree indexes covering `hub_id`, `factory_id`, `logistics_provider_id`, `pickup_status`, `lifecycle_status`, `material_category`, `kyc_status`, `user_id`, `target_role`, `governorate`, `hub_type`, and `disputes.status`).
- **Baseline Drizzle SQL Migration:** `drizzle/0000_baseline_ouro_schema.sql` with metadata journal `drizzle/meta/_journal.json`.

### Transaction Boundaries, Concurrency & Idempotency Guarantees
1. **Atomic Stock Reservations (`POST /api/reservations`):**
   - Executes inside a single PostgreSQL transaction (`db.transaction`).
   - Checks `idempotency_keys` (`Idempotency-Key` header) scoped by `(key, userId, endpoint)` before mutating state so network retries return the exact original `201` response without double-booking.
   - Acquires row-level `SELECT ... FOR UPDATE` locks on `waste_passports` and `waste_source_hubs` before deducting `available_tons` and incrementing `reserved_tons`.
   - Verified under concurrent contention (4 simultaneous 2t bookings against a 5t lot -> strictly 2 succeed with `201`, 2 receive `409 Conflict`, zero overselling).
2. **Atomic Cancellation & Stock Restoration (`POST /api/reservations/:id/cancel`):**
   - Acquires `FOR UPDATE` locks on the reservation, passport, and hub inside a single transaction, transitions reservation status to `cancelled`, restores `available_tons`, decrements `reserved_tons`, and appends a SHA-256 passport audit event.
3. **Sequential 3PL Stage Progression (`PATCH /api/reservations/:id/status`):**
   - Locks reservation, passport, and hub (`FOR UPDATE`), enforces strict sequential stage transitions (`scheduled -> accepted -> en_route -> arrived -> picked_up -> delivered`; out-of-order jumps return `409`), requires QR passport match on `picked_up`, validates carrier vehicle ownership, and appends chained `passport_events`.
4. **Independent 2-Step Stage 7 Verification:**
   - Factory intake (`POST /api/reservations/:id/receive`) and recycling submission (`POST /api/reservations/:id/recycle`) validate mass balance (`recovered + residual + loss <= delivered`) inside transactions while keeping Stage 6 `DELIVERED` and `verified_co2e_tons = 0` until a Platform Admin approves via `POST /api/admin/reservations/:id/verify-recycling`.
5. **Connection Pooling (`src/infra/database.ts`):**
   - Cloud-agnostic PostgreSQL pool supporting `DATABASE_URL`, Cloud SQL Unix sockets (`DB_SOCKET_PATH`), or discrete `SQL_HOST`/`SQL_PORT`/`SQL_DB_NAME`/`SQL_USER`/`SQL_PASSWORD` credentials.
   - Configurable pool limits (`DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, `DB_CONNECT_TIMEOUT_MS`), TLS modes (`disable | require | no-verify` + optional `DB_SSL_CA_CERT`), and graceful `SIGINT`/`SIGTERM` pool drain.

---

## 2. Schema Migration Governance (Zero-Downtime Discipline)

1. **Never run destructive push commands in staging or production.** Use versioned Drizzle SQL migrations under `./drizzle/`.
2. **Generate a new migration after editing `src/db/schema.ts`:**
   ```bash
   npx drizzle-kit generate --config=src/db/drizzle.config.ts --name <descriptive_change_name>
   ```
3. **Review generated SQL before applying:**
   - Verify no unintended `DROP TABLE`, `DROP COLUMN`, or data-truncating `ALTER COLUMN TYPE` statements exist.
   - For high-traffic production tables (`reservations`, `passport_events`, `waste_passports`), add new columns as nullable or with lightweight defaults first, backfill in batches, and add `CREATE INDEX CONCURRENTLY` where lock duration matters.
4. **Apply migrations against a pre-backed-up target:**
   ```bash
   npx drizzle-kit migrate --config=src/db/drizzle.config.ts
   ```
   > Note: On an existing database initialized before the baseline migration was tracked in `__drizzle_migrations`, take a verified backup first and record the baseline migration hash in the Drizzle migration journal table before applying incremental `0001+` migrations.

---

## 3. Logical Backup Procedures (`pg_dump`)

Logical backups are provider-independent and work identically against local PostgreSQL, Google Cloud SQL, AWS RDS, Neon, or self-hosted PostgreSQL.

### 3.1 Create an Encrypted Custom-Format Logical Backup
Custom format (`-Fc`) produces a compressed, single-file archive supporting parallel selective restoration (`pg_restore`).

```bash
export TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
export BACKUP_FILE="ouro_pg_${TIMESTAMP}.dump"

# 1. Dump database consistently (single snapshot, no table locks on reads)
pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --verbose \
  "$DATABASE_URL" \
  --file="/tmp/${BACKUP_FILE}"

# 2. Generate SHA-256 checksum
sha256sum "/tmp/${BACKUP_FILE}" > "/tmp/${BACKUP_FILE}.sha256"

# 3. Encrypt at rest before off-host upload (symmetric AES-256 or KMS envelope encryption)
gpg --symmetric --cipher-algo AES256 --batch --passphrase-file /run/secrets/backup_key \
  "/tmp/${BACKUP_FILE}"

# 4. Upload encrypted archive + checksum to private versioned object storage (S3 or GCS)
# AWS S3 example:
# aws s3 cp "/tmp/${BACKUP_FILE}.gpg" "s3://${BACKUP_BUCKET}/postgres/daily/${BACKUP_FILE}.gpg" --sse aws:kms
# GCS example:
# gsutil cp "/tmp/${BACKUP_FILE}.gpg" "gs://${BACKUP_BUCKET}/postgres/daily/${BACKUP_FILE}.gpg"

# 5. Clean local temporary files
shred -u "/tmp/${BACKUP_FILE}" "/tmp/${BACKUP_FILE}.gpg" "/tmp/${BACKUP_FILE}.sha256"
```

### 3.2 Recommended Retention Schedule
- **Daily logical backups:** Retain for **30 days** in a separate private bucket with object versioning and lifecycle expiration.
- **Weekly backups:** Retain for **12 weeks**.
- **Monthly compliance snapshots:** Retain for **12+ months** (aligned with ESG audit traceability requirements for Digital Waste Passports).
- **Private object storage sync:** Always back up private evidence files (`STORAGE_PROVIDER` bucket / `./storage/private`) on the same cadence so `file_objects` rows remain consistent with binary blobs.

---

## 4. Restoration & Verification Drill Procedures (`pg_restore`)

Never restore directly over a live production database. Always restore into a **clean isolated target database**, validate data and SHA-256 passport chain integrity, and perform a controlled traffic cutover.

### 4.1 Step-by-Step Restore into Clean Target Database
```bash
# 1. Download and decrypt archive
gpg --decrypt --batch --passphrase-file /run/secrets/backup_key \
  --output "/tmp/${BACKUP_FILE}" "/tmp/${BACKUP_FILE}.gpg"

# 2. Verify archive integrity checksum before touching PostgreSQL
sha256sum -c "/tmp/${BACKUP_FILE}.sha256"

# 3. Create isolated target database
createdb -h "$RESTORE_HOST" -U "$RESTORE_ADMIN_USER" "ouro_restore_${TIMESTAMP}"

# 4. Restore schema, data, indexes, and foreign keys atomically
pg_restore \
  --host="$RESTORE_HOST" \
  --username="$RESTORE_ADMIN_USER" \
  --dbname="ouro_restore_${TIMESTAMP}" \
  --no-owner \
  --no-privileges \
  --single-transaction \
  --exit-on-error \
  --verbose \
  "/tmp/${BACKUP_FILE}"
```

### 4.2 Post-Restore Verification Checklist
Run all four checks before promoting the restored database:
1. **Schema & constraint parity:** Confirm 14 tables and 23 foreign keys exist:
   ```sql
   SELECT count(*) AS table_count FROM information_schema.tables WHERE table_schema = 'public';
   SELECT count(*) AS fk_count FROM pg_constraint WHERE contype = 'f';
   ```
2. **Row-count sanity:** Confirm core tables (`users`, `waste_source_hubs`, `recycling_factories`, `waste_passports`, `passport_events`, `reservations`, `emission_factors`) match expected pre-incident ranges.
3. **Sequence alignment:** Confirm `serial` sequences are synced to `MAX(id)` (handled automatically by `pg_restore`, spot-check with `SELECT last_value FROM waste_passports_id_seq;`).
4. **Application & Hash Chain Verification:** Point a staging API instance at the restored database, verify `GET /api/ready` returns `{"ready":true,"database":true}`, and run `GET /api/passports/:code/verify-chain` on recent Stage 7 passports to confirm `valid: true`.

**Monthly Drill Policy:** Execute an automated restore drill into a disposable staging database at least once per month and log observed **RTO** (Recovery Time Objective) and **RPO** (Recovery Point Objective).

---

## 5. Future PostgreSQL Point-in-Time Recovery (PITR) Configuration

Logical `pg_dump` backups provide an RPO equal to the backup interval (typically 24 hours). For commercial production deployments requiring **sub-minute RPO** (recovery to any exact second before an accidental deletion or bad migration), enable continuous **Write-Ahead Log (WAL) archiving and PITR** on your target cloud provider without changing any OURO application code.

### 5.1 Option A — Google Cloud SQL for PostgreSQL
- Enable automated daily backups + binary/WAL transaction log retention:
  - `backup_configuration.enabled = true`
  - `backup_configuration.point_in_time_recovery_enabled = true`
  - `backup_configuration.transaction_log_retention_days = 7` (up to 7 days on Enterprise, 35 days on Enterprise Plus)
  - `backup_configuration.retained_backups = 30`
- **Recovery command:** Clone the instance to an exact UTC timestamp (`gcloud sql instances clone ouro-prod ouro-pitr-recovery --point-in-time='YYYY-MM-DDTHH:MM:SS.000Z'`), verify integrity, then swap `DATABASE_URL` / `DB_SOCKET_PATH`.

### 5.2 Option B — AWS RDS / Aurora for PostgreSQL
- Configure managed automated backups (`BackupRetentionPeriod = 14` to `35` days) with Multi-AZ deployment and KMS encryption enabled.
- RDS automatically archives PostgreSQL WAL segments to S3 every ~5 minutes.
- **Recovery command:** Use `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier ouro-prod --target-db-instance-identifier ouro-pitr-recovery --restore-time YYYY-MM-DDTHH:MM:SSZ`, verify integrity, then rotate application connection strings.

### 5.3 Option C — Self-Managed / Kubernetes PostgreSQL (`pgBackRest` or `WAL-G`)
Configure continuous WAL archiving to private S3-compatible or GCS storage in `postgresql.conf`:

```ini
wal_level = replica
archive_mode = on
archive_timeout = 60
archive_command = 'pgbackrest --stanza=ouro archive-push %p'
```

- Run a weekly full base backup (`pgbackrest --stanza=ouro --type=full backup`) and daily differential backups (`--type=diff`).
- To recover to an exact UTC second on a fresh standby host:
  ```bash
  pgbackrest --stanza=ouro --delta --type=time "--target=2026-11-22 14:30:00+00" --target-action=promote restore
  ```

### 5.4 Target Commercial Production Objectives
| Environment | Backup Strategy | Target RPO | Target RTO |
|---|---|---|---|
| **Local Development** | On-demand `pg_dump` | N/A | < 5 min |
| **Staging / Field Pilot** | Daily encrypted `pg_dump` to private bucket | <= 24 hours | <= 30 min |
| **Commercial Production** | Managed PITR (WAL archiving) + daily cross-region encrypted `pg_dump` | <= 5 minutes | <= 15 minutes |

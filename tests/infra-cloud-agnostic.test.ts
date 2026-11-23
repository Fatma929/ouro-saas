import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InfraConfigurationError,
  resolveInfraConfig,
} from '../src/infra/config.ts';
import {
  assertCacheConfigSafe,
  createCacheProvider,
  MemoryCacheProvider,
  RedisCacheProvider,
} from '../src/infra/cache/index.ts';
import { buildPostgresPoolConfig } from '../src/infra/database.ts';
import {
  createEmailProvider,
  ResendEmailProvider,
  SmtpEmailProvider,
} from '../src/infra/email/index.ts';
import { InProcessJobQueue, RedisJobQueue } from '../src/infra/jobs/index.ts';
import {
  createLogger,
  redactLogMeta,
  type LogEntry,
} from '../src/infra/logger.ts';
import {
  createStorageProvider,
  GcsStorageProvider,
  LocalStorageProvider,
  S3StorageProvider,
  verifyFileAccessToken,
} from '../src/infra/storage/index.ts';
import { canUserAccessFile } from '../src/lib/storage.ts';

const VALID_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF', 'utf8');
const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe('Phase 2 — Cloud-Agnostic Configuration Resolver', () => {
  it('defaults cleanly to local zero-cloud-spend development mode', () => {
    const cfg = resolveInfraConfig({ NODE_ENV: 'development' });
    expect(cfg.isProduction).toBe(false);
    expect(cfg.storage.provider).toBe('local');
    expect(cfg.cache.provider).toBe('memory');
    expect(cfg.cache.topology).toBe('single-instance');
    expect(cfg.email.provider).toBe('none');
    expect(cfg.jobs.provider).toBe('memory');
    expect(cfg.logging.format).toBe('json');
  });

  it('switches providers purely through environment variables', () => {
    const cfg = resolveInfraConfig({
      NODE_ENV: 'production',
      STORAGE_PROVIDER: 's3',
      STORAGE_SIGNED_URL_MODE: 'direct',
      S3_BUCKET: 'ouro-prod-docs',
      S3_REGION: 'eu-west-1',
      S3_ENDPOINT: 'https://r2.example.invalid',
      REDIS_URL: 'rediss://default:pass@redis.example.invalid:6379',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_test_key',
      JOBS_PROVIDER: 'redis',
      DATABASE_URL: 'postgres://user:pass@rds.example.invalid:5432/ouro',
      DB_SSL: 'require',
    });
    expect(cfg.storage.provider).toBe('s3');
    expect(cfg.storage.signedUrlMode).toBe('direct');
    expect(cfg.storage.s3.forcePathStyle).toBe(true);
    expect(cfg.cache.provider).toBe('redis');
    expect(cfg.cache.topology).toBe('multi-instance');
    expect(cfg.email.provider).toBe('resend');
    expect(cfg.jobs.provider).toBe('redis');
    expect(cfg.database.sslMode).toBe('require');
  });

  it('rejects unsupported provider names explicitly', () => {
    expect(() => resolveInfraConfig({ STORAGE_PROVIDER: 'azure_blob' })).toThrow(
      InfraConfigurationError
    );
    expect(() => resolveInfraConfig({ CACHE_PROVIDER: 'memcached' })).toThrow(
      InfraConfigurationError
    );
    expect(() => resolveInfraConfig({ EMAIL_PROVIDER: 'carrier_pigeon' })).toThrow(
      InfraConfigurationError
    );
  });

  it('safely ignores bare numeric placeholder stubs ONLY inside positively identified preview runtime', () => {
    const cfg = resolveInfraConfig({
      NODE_ENV: 'development',
      K_SERVICE: 'ais-dev-preview123',
      STORAGE_PROVIDER: '212',
      STORAGE_SIGNED_URL_MODE: '213',
      STORAGE_MAX_FILE_BYTES: '214',
      LOCAL_STORAGE_DIR: '215',
      CACHE_PROVIDER: '216',
      DEPLOYMENT_TOPOLOGY: '217',
      REDIS_URL: '2010',
      EMAIL_PROVIDER: '218',
      RESEND_API_KEY: '219',
      SMTP_HOST: '1964',
      SMTP_PORT: '1974',
      JOBS_PROVIDER: '220',
      JOBS_MAX_ATTEMPTS: '221',
      DATABASE_URL: '222',
      SQL_PORT: '2026',
      DB_SOCKET_PATH: '223',
      DB_SSL_CA_CERT: '224',
      DB_POOL_MAX: '209',
      DB_IDLE_TIMEOUT_MS: '210',
      DB_CONNECT_TIMEOUT_MS: '211',
      TRUST_PROXY: '225',
      SERVICE_NAME: '226',
      LOG_LEVEL: '227',
      LOG_FORMAT: '228',
    });
    expect(cfg.isPreviewRuntime).toBe(true);
    expect(cfg.storage.provider).toBe('local');
    expect(cfg.storage.signedUrlMode).toBe('proxy');
    expect(cfg.storage.maxFileSizeBytes).toBe(8 * 1024 * 1024);
    expect(cfg.storage.local.rootDir.endsWith(path.join('storage', 'private'))).toBe(true);
    expect(cfg.cache.provider).toBe('memory');
    expect(cfg.cache.topology).toBe('single-instance');
    expect(cfg.email.provider).toBe('none');
    expect(cfg.jobs.provider).toBe('memory');
    expect(cfg.jobs.defaultMaxAttempts).toBe(3);
    expect(cfg.database.connectionString).toBeUndefined();
    expect(cfg.database.port).toBe(5432);
    expect(cfg.database.socketPath).toBeUndefined();
    expect(cfg.database.sslCaCert).toBeUndefined();
    expect(cfg.database.poolMax).toBe(10);
    expect(cfg.http.trustProxy).toBe(1);
    expect(cfg.logging.serviceName).toBe('ouro-api');
  });

  it('preserves legitimate numeric settings faithfully in development, test, staging, and production', () => {
    for (const envName of ['development', 'test', 'staging', 'production'] as const) {
      const cfg = resolveInfraConfig({
        NODE_ENV: envName,
        PORT: '4000',
        TRUST_PROXY: '2',
        SQL_HOST: 'db.internal',
        SQL_PORT: '6432',
        DB_POOL_MAX: '25',
        DB_IDLE_TIMEOUT_MS: '45000',
        DB_CONNECT_TIMEOUT_MS: '8000',
        STORAGE_PROVIDER: envName === 'production' ? 's3' : 'local',
        S3_BUCKET: envName === 'production' ? 'ouro-prod-bucket' : '',
        STORAGE_MAX_FILE_BYTES: '12582912',
        CACHE_PROVIDER: envName === 'production' ? 'redis' : 'memory',
        REDIS_URL: envName === 'production' ? 'rediss://default:pass@redis.internal:6379' : '',
        REDIS_CONNECT_TIMEOUT_MS: '7500',
        JOBS_MAX_ATTEMPTS: '5',
        JOBS_BACKOFF_MS: '1500',
      });
      expect(cfg.isPreviewRuntime).toBe(false);
      expect(cfg.http.port).toBe(4000);
      expect(cfg.http.trustProxy).toBe(2);
      expect(cfg.database.port).toBe(6432);
      expect(cfg.database.poolMax).toBe(25);
      expect(cfg.database.idleTimeoutMillis).toBe(45_000);
      expect(cfg.database.connectionTimeoutMillis).toBe(8_000);
      expect(cfg.storage.maxFileSizeBytes).toBe(12_582_912);
      expect(cfg.cache.redisConnectTimeoutMs).toBe(7500);
      expect(cfg.jobs.defaultMaxAttempts).toBe(5);
      expect(cfg.jobs.defaultBackoffMs).toBe(1500);
    }
  });

  it('never treats numeric values as placeholders in production and rejects invalid provider or numeric values explicitly', () => {
    // Even if preview-like K_SERVICE is present, NODE_ENV=production MUST disable preview stub handling
    expect(() =>
      resolveInfraConfig({
        NODE_ENV: 'production',
        K_SERVICE: 'ais-dev-preview123',
        STORAGE_PROVIDER: '212',
      })
    ).toThrow(InfraConfigurationError);

    expect(() =>
      resolveInfraConfig({
        NODE_ENV: 'production',
        DATABASE_URL: '222',
      })
    ).toThrow(/postgres:\/\//i);

    expect(() =>
      resolveInfraConfig({
        NODE_ENV: 'production',
        SQL_PORT: 'not-a-port',
      })
    ).toThrow(InfraConfigurationError);

    expect(() =>
      resolveInfraConfig({
        NODE_ENV: 'production',
        DB_POOL_MAX: '500',
      })
    ).toThrow(/out of allowed range/i);

    expect(() =>
      resolveInfraConfig({
        NODE_ENV: 'production',
        TRUST_PROXY: 'invalid',
      })
    ).toThrow(InfraConfigurationError);
  });
});

describe('Phase 2 — Database Connectivity Abstraction', () => {
  it('supports 12-factor DATABASE_URL with TLS', () => {
    const cfg = resolveInfraConfig({
      DATABASE_URL: 'postgres://ouro:secret@db.internal:5432/ouro_prod',
      DB_SSL: 'require',
      DB_POOL_MAX: '20',
    });
    const { poolConfig, connectionMode } = buildPostgresPoolConfig(cfg.database);
    expect(connectionMode).toBe('connection_string');
    expect(poolConfig.connectionString).toContain('db.internal');
    expect(poolConfig.max).toBe(20);
    expect(poolConfig.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('supports Unix domain socket connectivity (e.g. Cloud SQL Auth Proxy)', () => {
    const cfg = resolveInfraConfig({
      DB_SOCKET_PATH: '/cloudsql/proj:region:inst',
      SQL_USER: 'ouro',
      SQL_PASSWORD: 'pw',
      SQL_DB_NAME: 'ouro',
    });
    const { poolConfig, connectionMode } = buildPostgresPoolConfig(cfg.database);
    expect(connectionMode).toBe('unix_socket');
    expect(poolConfig.host).toBe('/cloudsql/proj:region:inst');
    expect(poolConfig.ssl).toBe(false);
  });

  it('supports discrete SQL_* TCP parameters for local & existing environments', () => {
    const cfg = resolveInfraConfig({
      SQL_HOST: '127.0.0.1',
      SQL_PORT: '5433',
      SQL_USER: 'app',
      SQL_PASSWORD: 'pw',
      SQL_DB_NAME: 'ouro_dev',
    });
    const { poolConfig, connectionMode } = buildPostgresPoolConfig(cfg.database);
    expect(connectionMode).toBe('tcp_params');
    expect(poolConfig.host).toBe('127.0.0.1');
    expect(poolConfig.port).toBe(5433);
  });
});

describe('Phase 2 — Object Storage Abstraction (Local, S3-Compatible, GCS)', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('LocalStorageProvider supports upload, metadata, download, signed URLs, delete, and security guards', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouro-storage-test-'));
    const storage = new LocalStorageProvider({
      rootDir: tempDir,
      maxFileSizeBytes: 1024 * 1024,
    });

    const uploaded = await storage.upload({
      buffer: VALID_PDF,
      purpose: 'kyc_document',
      mimeType: 'application/pdf',
      originalName: 'license.pdf',
    });

    expect(uploaded.provider).toBe('local');
    expect(uploaded.key.startsWith('kyc_document/')).toBe(true);
    expect(uploaded.sha256).toBe(crypto.createHash('sha256').update(VALID_PDF).digest('hex'));

    expect(await storage.exists(uploaded.key)).toBe(true);
    const meta = await storage.getMetadata(uploaded.key);
    expect(meta?.sizeBytes).toBe(VALID_PDF.length);
    expect(meta?.sha256).toBe(uploaded.sha256);

    const downloaded = await storage.download(uploaded.key);
    expect(downloaded.equals(VALID_PDF)).toBe(true);

    const signed = await storage.getSignedDownloadUrl({
      key: uploaded.key,
      fileId: 42,
      userId: 7,
      ttlSeconds: 120,
    });
    expect(signed.mode).toBe('proxy');
    expect(signed.url).toContain('/api/storage/42?sig=');
    const token = decodeURIComponent(signed.url.split('sig=')[1]);
    expect(verifyFileAccessToken(42, token)).toEqual({ userId: 7 });
    expect(verifyFileAccessToken(99, token)).toBeNull();

    // Path traversal blocked
    await expect(storage.download('../etc/passwd')).rejects.toThrow('PATH_TRAVERSAL_BLOCKED');

    // Spoofed magic bytes blocked
    await expect(
      storage.upload({
        buffer: Buffer.from('not really a png file'),
        purpose: 'weighin_photo',
        mimeType: 'image/png',
      })
    ).rejects.toThrow('INVALID_FILE_SIGNATURE');

    // Deletion works and is idempotent
    expect(await storage.delete(uploaded.key)).toBe(true);
    expect(await storage.exists(uploaded.key)).toBe(false);
    expect(await storage.delete(uploaded.key)).toBe(false);

    const health = await storage.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.provider).toBe('local');
  });

  it('S3StorageProvider validates bucket config and executes S3 commands cleanly', async () => {
    const missingBucketCfg = resolveInfraConfig({ STORAGE_PROVIDER: 's3' }).storage;
    expect(() => createStorageProvider(missingBucketCfg)).toThrow(InfraConfigurationError);

    const s3Cfg = resolveInfraConfig({
      STORAGE_PROVIDER: 's3',
      S3_BUCKET: 'ouro-test-bucket',
      S3_REGION: 'eu-west-2',
      S3_KEY_PREFIX: 'tenant-prod',
    }).storage;

    const sentCommands: any[] = [];
    const mockS3Client = {
      send: vi.fn(async (cmd: any) => {
        sentCommands.push(cmd);
        const name = cmd.constructor?.name;
        if (name === 'PutObjectCommand') return { ETag: '"etag-123"' };
        if (name === 'GetObjectCommand') {
          return { Body: { transformToByteArray: async () => new Uint8Array(VALID_PNG) } };
        }
        if (name === 'HeadObjectCommand') {
          return {
            ContentType: 'image/png',
            ContentLength: VALID_PNG.length,
            ETag: '"etag-123"',
            Metadata: { sha256: 'abc123' },
            LastModified: new Date('2026-01-01T00:00:00Z'),
          };
        }
        if (name === 'DeleteObjectCommand') return {};
        if (name === 'HeadBucketCommand') return {};
        return {};
      }),
    } as any;

    const s3 = new S3StorageProvider(s3Cfg, mockS3Client);
    const up = await s3.upload({
      buffer: VALID_PNG,
      purpose: 'pod_document',
      mimeType: 'image/png',
    });
    expect(up.provider).toBe('s3');
    expect(up.etag).toBe('etag-123');
    expect(sentCommands[0].input.Key).toBe(`tenant-prod/${up.key}`);

    const dl = await s3.download(up.key);
    expect(dl.equals(VALID_PNG)).toBe(true);

    const meta = await s3.getMetadata(up.key);
    expect(meta?.sizeBytes).toBe(VALID_PNG.length);
    expect(meta?.sha256).toBe('abc123');

    const signedProxy = await s3.getSignedDownloadUrl({
      key: up.key,
      fileId: 10,
      userId: 2,
    });
    expect(signedProxy.mode).toBe('proxy');
    expect(signedProxy.provider).toBe('s3');

    expect(await s3.delete(up.key)).toBe(true);
    expect((await s3.healthCheck()).healthy).toBe(true);
  });

  it('GcsStorageProvider validates bucket config and executes GCS operations cleanly', async () => {
    const missingBucketCfg = resolveInfraConfig({ STORAGE_PROVIDER: 'gcs' }).storage;
    expect(() => createStorageProvider(missingBucketCfg)).toThrow(InfraConfigurationError);

    const gcsCfg = resolveInfraConfig({
      STORAGE_PROVIDER: 'gcs',
      STORAGE_SIGNED_URL_MODE: 'direct',
      GCS_BUCKET: 'ouro-gcs-bucket',
      GCS_KEY_PREFIX: 'env-stage',
    }).storage;

    const mockFile = {
      save: vi.fn(async () => {}),
      download: vi.fn(async () => [VALID_PDF]),
      exists: vi.fn(async () => [true]),
      delete: vi.fn(async () => {}),
      getMetadata: vi.fn(async () => [
        {
          contentType: 'application/pdf',
          size: String(VALID_PDF.length),
          etag: 'gcs-etag',
          updated: '2026-01-01T00:00:00Z',
          metadata: { sha256: 'deadbeef' },
        },
      ]),
      getSignedUrl: vi.fn(async () => ['https://storage.googleapis.com/signed-url-example']),
    };

    const mockGcsClient = {
      bucket: vi.fn(() => ({
        file: vi.fn(() => mockFile),
        exists: vi.fn(async () => [true]),
      })),
    } as any;

    const gcs = new GcsStorageProvider(gcsCfg, mockGcsClient);
    const up = await gcs.upload({
      buffer: VALID_PDF,
      purpose: 'recycling_evidence',
      mimeType: 'application/pdf',
    });
    expect(up.provider).toBe('gcs');
    expect(mockFile.save).toHaveBeenCalledTimes(1);

    const dl = await gcs.download(up.key);
    expect(dl.equals(VALID_PDF)).toBe(true);

    const signed = await gcs.getSignedDownloadUrl({
      key: up.key,
      fileId: 5,
      userId: 1,
      ttlSeconds: 180,
      downloadFilename: 'cert.pdf',
    });
    expect(signed.mode).toBe('direct');
    expect(signed.url).toBe('https://storage.googleapis.com/signed-url-example');

    const meta = await gcs.getMetadata(up.key);
    expect(meta?.sha256).toBe('deadbeef');
    expect(await gcs.delete(up.key)).toBe(true);
    expect((await gcs.healthCheck()).healthy).toBe(true);
  });

  it('preserves existing file access-control rules (KYC isolation & org boundaries)', () => {
    const kycFile = {
      purpose: 'kyc_document',
      uploadedByUid: 'factory-owner-1',
      ownerOrgType: 'factory',
      ownerOrgId: 10,
    };

    expect(canUserAccessFile(null, kycFile)).toBe(false);
    expect(
      canUserAccessFile(
        {
          id: 2,
          uid: 'other-factory',
          email: 'other@fac.eg',
          fullName: 'Other',
          phone: null,
          accountCode: null,
          language: 'en',
          role: 'factory_procurement',
          hubId: null,
          factoryId: 99,
          logisticsProviderId: null,
        },
        kycFile
      )
    ).toBe(false);
    expect(
      canUserAccessFile(
        {
          id: 3,
          uid: 'same-factory-member',
          email: 'member@fac.eg',
          fullName: 'Member',
          phone: null,
          accountCode: null,
          language: 'en',
          role: 'factory_procurement',
          hubId: null,
          factoryId: 10,
          logisticsProviderId: null,
        },
        kycFile
      )
    ).toBe(true);
    expect(
      canUserAccessFile(
        {
          id: 1,
          uid: 'admin-1',
          email: 'admin@ouro.eg',
          fullName: 'Admin',
          phone: null,
          accountCode: null,
          language: 'en',
          role: 'platform_admin',
          hubId: null,
          factoryId: null,
          logisticsProviderId: null,
        },
        kycFile
      )
    ).toBe(true);
  });
});

describe('Phase 2 — Cache & Rate Limiting (Memory + Redis + Production Multi-Instance Guard)', () => {
  it('NEVER allows silent in-memory rate limiting in multi-instance production', () => {
    const prodMultiNoRedis = resolveInfraConfig({
      NODE_ENV: 'production',
      DEPLOYMENT_TOPOLOGY: 'multi-instance',
    });
    expect(() => assertCacheConfigSafe(prodMultiNoRedis.cache, prodMultiNoRedis.isProduction)).toThrow(
      /In-memory rate limiting is forbidden in multi-instance production/
    );

    const explicitRedisNoUrl = resolveInfraConfig({
      NODE_ENV: 'development',
      CACHE_PROVIDER: 'redis',
    });
    expect(() => createCacheProvider(explicitRedisNoUrl)).toThrow(/REDIS_URL is empty/);

    const prodSingleWithoutOptIn = resolveInfraConfig({
      NODE_ENV: 'production',
      DEPLOYMENT_TOPOLOGY: 'single-instance',
    });
    expect(() => createCacheProvider(prodSingleWithoutOptIn)).toThrow(
      /ALLOW_IN_MEMORY_CACHE_IN_PROD=true/
    );

    expect(() =>
      resolveInfraConfig({
        NODE_ENV: 'production',
        DEPLOYMENT_TOPOLOGY: 'multi-instance',
        REDIS_URL: 'not-a-valid-redis-url',
      })
    ).toThrow(/valid redis:\/\/ or rediss:\/\//);

    // Standard dev explicitly rejects malformed REDIS_URL instead of silently ignoring it
    expect(() =>
      resolveInfraConfig({
        NODE_ENV: 'development',
        REDIS_URL: 'placeholder-value',
      })
    ).toThrow(/valid redis:\/\/ or rediss:\/\//);

    // Positively identified preview runtime safely ignores injected numeric stub
    const previewWithStub = resolveInfraConfig({
      NODE_ENV: 'development',
      K_SERVICE: 'ais-dev-preview123',
      REDIS_URL: '2010',
    });
    expect(previewWithStub.cache.provider).toBe('memory');
  });

  it('supports local MemoryCacheProvider for development without Redis', async () => {
    const devCfg = resolveInfraConfig({ NODE_ENV: 'development' });
    const cache = createCacheProvider(devCfg);
    expect(cache.providerName).toBe('memory');
    expect(cache.distributed).toBe(false);

    await cache.set('test:k', { ok: true }, 60);
    expect(await cache.get<{ ok: boolean }>('test:k')).toEqual({ ok: true });
    expect(await cache.del('test:k')).toBe(true);
    expect(await cache.get('test:k')).toBeNull();

    const now = Date.now();
    expect(await cache.recordAndCount('auth:127.0.0.1', now, 1000)).toBe(1);
    expect(await cache.recordAndCount('auth:127.0.0.1', now + 10, 1000)).toBe(2);
    expect(await cache.recordAndCount('auth:127.0.0.1', now + 2000, 1000)).toBe(1);
    await cache.close();
  });

  it('supports RedisCacheProvider with atomic Lua sliding window in multi-instance production', async () => {
    const prodRedisCfg = resolveInfraConfig({
      NODE_ENV: 'production',
      DEPLOYMENT_TOPOLOGY: 'multi-instance',
      REDIS_URL: 'rediss://redis.internal:6379',
    });
    expect(() => assertCacheConfigSafe(prodRedisCfg.cache, prodRedisCfg.isProduction)).not.toThrow();

    const store = new Map<string, string>();
    let evalCalls = 0;
    const mockRedis = {
      status: 'ready',
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
      del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
      eval: vi.fn(async () => ++evalCalls),
      ping: vi.fn(async () => 'PONG'),
      quit: vi.fn(async () => 'OK'),
      disconnect: vi.fn(),
    } as any;

    const redisCache = new RedisCacheProvider(prodRedisCfg.cache, mockRedis);
    expect(redisCache.distributed).toBe(true);
    await redisCache.set('session:1', { active: true }, 300);
    expect(await redisCache.get('session:1')).toEqual({ active: true });
    expect(await redisCache.recordAndCount('auth:10.0.0.1', Date.now(), 60_000)).toBe(1);
    expect(await redisCache.recordAndCount('auth:10.0.0.1', Date.now(), 60_000)).toBe(2);

    const health = await redisCache.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.provider).toBe('redis');
    expect(health.distributed).toBe(true);
    await redisCache.close();
    expect(mockRedis.quit).toHaveBeenCalledTimes(1);
  });
});

describe('Phase 2 — Email Delivery, Background Jobs & Structured Logger', () => {
  it('EmailProvider handles none, resend, and smtp cleanly', async () => {
    const noop = createEmailProvider(resolveInfraConfig({}).email);
    expect(noop.getStatus().configured).toBe(false);
    const skipped = await noop.send({ to: 'a@b.eg', subject: 'Hi', text: 'Body' });
    expect(skipped.sent).toBe(false);

    // Non-Resend and non-hostname placeholder values must not accidentally enable external email when EMAIL_PROVIDER is unset
    const placeholderIgnored = createEmailProvider(
      resolveInfraConfig({
        RESEND_API_KEY: 'placeholder-value',
        SMTP_HOST: '1964',
        SMTP_USER: 'stub',
        SMTP_PASS: 'stub',
      }).email
    );
    expect(placeholderIgnored.getStatus().provider).toBe('none');
    expect(placeholderIgnored.getStatus().configured).toBe(false);

    const resendCfg = resolveInfraConfig({
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_mock_12345',
      EMAIL_FROM: 'OURO <ops@ouro.eg>',
    }).email;
    const mockFetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: 're_msg_001' }), { status: 200 })
    ) as unknown as typeof fetch;
    const resend = new ResendEmailProvider(resendCfg, mockFetch);
    const resResult = await resend.send({ to: 'buyer@factory.eg', subject: 'Test', text: 'Hello' });
    expect(resResult).toEqual({ sent: true, provider: 'resend', messageId: 're_msg_001' });

    const smtpCfg = resolveInfraConfig({
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.invalid',
      SMTP_USER: 'mailer',
      SMTP_PASS: 'secret',
    }).email;
    const mockTransport = {
      sendMail: vi.fn(async () => ({ messageId: '<smtp-001@ouro>' })),
    } as any;
    const smtp = new SmtpEmailProvider(smtpCfg, mockTransport);
    const smtpResult = await smtp.send({ to: 'ops@hub.eg', subject: 'SMTP Test', text: 'Hello' });
    expect(smtpResult).toEqual({ sent: true, provider: 'smtp', messageId: '<smtp-001@ouro>' });
  });

  it('InProcessJobQueue supports retries, deduplication, dead-lettering, and RedisJobQueue prepares distributed workers', async () => {
    const cfg = resolveInfraConfig({ JOBS_MAX_ATTEMPTS: '2', JOBS_BACKOFF_MS: '50' }).jobs;
    const queue = new InProcessJobQueue(cfg);

    let flakyAttempts = 0;
    queue.registerHandler('flaky.task', async () => {
      flakyAttempts += 1;
      if (flakyAttempts < 2) throw new Error('transient error');
    });
    queue.registerHandler('broken.task', async () => {
      throw new Error('permanent error');
    });

    await queue.enqueue('flaky.task', { id: 1 }, { dedupeKey: 'flaky:1' });
    await queue.enqueue('flaky.task', { id: 1 }, { dedupeKey: 'flaky:1' }); // deduplicated
    await queue.enqueue('broken.task', { id: 2 });

    await new Promise((r) => setTimeout(r, 200));

    expect(flakyAttempts).toBe(2);
    const metrics = queue.getMetrics();
    expect(metrics.processed).toBe(1);
    expect(metrics.deadLetterCount).toBe(1);
    expect(queue.getDeadLetters()[0].name).toBe('broken.task');
    await queue.shutdown();

    // RedisJobQueue adapter test via injected mock client
    const lists = new Map<string, string[]>();
    const mockRedis = {
      status: 'ready',
      lpush: vi.fn(async (k: string, v: string) => {
        const arr = lists.get(k) || [];
        arr.unshift(v);
        lists.set(k, arr);
        return arr.length;
      }),
      rpop: vi.fn(async (k: string) => (lists.get(k) || []).pop() ?? null),
      zadd: vi.fn(async () => 1),
      quit: vi.fn(async () => 'OK'),
      disconnect: vi.fn(),
    } as any;

    const redisQueue = new RedisJobQueue(
      resolveInfraConfig({ JOBS_PROVIDER: 'redis', REDIS_URL: 'redis://localhost:6379' }).jobs,
      mockRedis
    );
    const received: any[] = [];
    redisQueue.registerHandler('email.send', async (payload) => {
      received.push(payload);
    });
    await redisQueue.enqueue('email.send', { to: 'user@ouro.eg' });
    expect(await redisQueue.processNext('email.send')).toBe(true);
    expect(received).toEqual([{ to: 'user@ouro.eg' }]);
    await redisQueue.shutdown();
  });

  it('StructuredLogger redacts secrets recursively and supports child bindings', () => {
    const entries: LogEntry[] = [];
    const log = createLogger({
      level: 'info',
      format: 'json',
      serviceName: 'ouro-test',
      sink: { write: (e) => entries.push(e) },
    });

    log.debug('ignored_debug', { ok: true });
    log.child({ requestId: 'req-123' }).info('auth_event', {
      userId: 5,
      password: 'plain-password',
      nested: { apiKey: 'sk-1234', safeField: 'visible' },
    });

    expect(entries.length).toBe(1);
    expect(entries[0].meta).toEqual({
      requestId: 'req-123',
      userId: 5,
      password: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', safeField: 'visible' },
    });
    expect(redactLogMeta({ authorization: 'Bearer abc' })).toEqual({
      authorization: '[REDACTED]',
    });
  });
});

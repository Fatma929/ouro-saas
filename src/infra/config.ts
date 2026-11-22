import path from 'path';

export type StorageProviderName = 'local' | 's3' | 'gcs';
export type StorageSignedUrlMode = 'proxy' | 'direct';
export type CacheProviderName = 'memory' | 'redis';
export type DeploymentTopology = 'single-instance' | 'multi-instance';
export type EmailProviderName = 'none' | 'resend' | 'smtp';
export type JobsProviderName = 'memory' | 'redis';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'pretty';
export type DbSslMode = 'disable' | 'require' | 'no-verify';

export class InfraConfigurationError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'InfraConfigurationError';
    this.code = code;
  }
}

export interface StorageConfig {
  provider: StorageProviderName;
  signedUrlMode: StorageSignedUrlMode;
  maxFileSizeBytes: number;
  local: {
    rootDir: string;
  };
  s3: {
    bucket: string;
    region: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle: boolean;
    keyPrefix: string;
  };
  gcs: {
    bucket: string;
    projectId?: string;
    keyFilename?: string;
    keyPrefix: string;
  };
}

export interface DatabaseConfig {
  connectionString?: string;
  host?: string;
  port: number;
  user?: string;
  password?: string;
  database?: string;
  socketPath?: string;
  sslMode: DbSslMode;
  sslCaCert?: string;
  poolMax: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

export interface CacheConfig {
  provider: CacheProviderName;
  topology: DeploymentTopology;
  allowInMemoryInProd: boolean;
  redisUrl?: string;
  redisKeyPrefix: string;
  redisConnectTimeoutMs: number;
}

export interface EmailConfig {
  provider: EmailProviderName;
  fromAddress: string;
  resendApiKey?: string;
  smtp: {
    host?: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
  };
}

export interface JobsConfig {
  provider: JobsProviderName;
  redisUrl?: string;
  redisKeyPrefix: string;
  defaultMaxAttempts: number;
  defaultBackoffMs: number;
}

export interface LoggingConfig {
  level: LogLevel;
  format: LogFormat;
  serviceName: string;
}

export interface InfraConfig {
  env: string;
  isProduction: boolean;
  http: {
    port: number;
    trustProxy: number | boolean;
    allowedOrigins: string[];
  };
  storage: StorageConfig;
  database: DatabaseConfig;
  cache: CacheConfig;
  email: EmailConfig;
  jobs: JobsConfig;
  logging: LoggingConfig;
}

function parseBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(normalized)) return true;
  if (['false', 'no', 'off', '0'].includes(normalized)) return false;
  return fallback;
}

function parseIntSafe(
  value: string | undefined,
  fallback: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER
): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return Math.floor(n);
}

function isNumericStub(value: string | undefined): boolean {
  return Boolean(value && /^\d+$/.test(value.trim()));
}

/**
 * Ignores empty strings and bare numeric placeholder IDs (e.g. "212") that preview runtimes
 * may auto-inject from .env.example templates, while preserving real configuration strings
 * and still rejecting mistyped non-numeric provider names.
 */
function cleanStringEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || isNumericStub(trimmed)) return undefined;
  return trimmed;
}

function normalizePrefix(prefix: string | undefined): string {
  const cleaned = cleanStringEnv(prefix);
  if (!cleaned) return '';
  return cleaned.replace(/^\/+|\/+$/g, '');
}

export function isValidRedisUrl(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith('redis://') && !trimmed.startsWith('rediss://')) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function isValidPostgresUrl(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith('postgres://') && !trimmed.startsWith('postgresql://')) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function isValidResendApiKey(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.startsWith('re_') && trimmed.length >= 10;
}

export function isValidSmtpHost(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'localhost') return true;
  // Reject bare numeric strings (e.g. injected placeholder IDs) and whitespace; require a domain dot or IPv6 colon
  if (/^\d+$/.test(trimmed) || /\s/.test(trimmed)) return false;
  return trimmed.includes('.') || trimmed.includes(':');
}

function isValidUnixSocketPath(value: string | undefined): boolean {
  const cleaned = cleanStringEnv(value);
  return Boolean(cleaned && cleaned.startsWith('/'));
}

function isValidCaCert(value: string | undefined): boolean {
  const cleaned = cleanStringEnv(value);
  if (!cleaned) return false;
  return cleaned.includes('BEGIN CERTIFICATE') || cleaned.startsWith('/') || cleaned.startsWith('./');
}

/**
 * Resolves all cloud-agnostic infrastructure configuration from process.env (or a supplied env map for testing).
 * Business modules read from these interfaces instead of branching on vendor-specific env vars.
 */
export function resolveInfraConfig(env: NodeJS.ProcessEnv = process.env): InfraConfig {
  const nodeEnv = (cleanStringEnv(env.NODE_ENV) || 'development').toLowerCase();
  const isProduction = nodeEnv === 'production';

  // 1. Storage provider selection
  const explicitStorage = cleanStringEnv(env.STORAGE_PROVIDER)?.toLowerCase();
  const rawStorage = explicitStorage || 'local';
  const storageProvider: StorageProviderName =
    rawStorage === 's3' || rawStorage === 'gcs' || rawStorage === 'local'
      ? rawStorage
      : (() => {
          throw new InfraConfigurationError(
            'INVALID_STORAGE_PROVIDER',
            `Unsupported STORAGE_PROVIDER "${env.STORAGE_PROVIDER}". Expected "local", "s3", or "gcs".`
          );
        })();

  const rawSignedMode = (cleanStringEnv(env.STORAGE_SIGNED_URL_MODE) || 'proxy').toLowerCase();
  const signedUrlMode: StorageSignedUrlMode = rawSignedMode === 'direct' ? 'direct' : 'proxy';

  // 2. Database configuration (supports standard DATABASE_URL or discrete SQL_* vars + Cloud SQL / Unix sockets)
  const rawSsl = (cleanStringEnv(env.DB_SSL) || cleanStringEnv(env.PGSSLMODE) || 'disable').toLowerCase();
  const sslMode: DbSslMode =
    rawSsl === 'true' || rawSsl === 'require' || rawSsl === 'verify-full'
      ? 'require'
      : rawSsl === 'no-verify' || rawSsl === 'allow-self-signed'
      ? 'no-verify'
      : 'disable';

  const rawDatabaseUrl = env.DATABASE_URL?.trim();
  const validDatabaseUrl = isValidPostgresUrl(rawDatabaseUrl) ? rawDatabaseUrl : undefined;

  // 3. Cache & Rate Limiting selection
  const explicitTopology = cleanStringEnv(env.DEPLOYMENT_TOPOLOGY)?.toLowerCase();
  const topology: DeploymentTopology =
    explicitTopology === 'single-instance'
      ? 'single-instance'
      : explicitTopology === 'multi-instance'
      ? 'multi-instance'
      : isProduction
      ? 'multi-instance'
      : 'single-instance';

  const rawRedisUrl = env.REDIS_URL?.trim() || undefined;
  const hasValidRedisUrl = isValidRedisUrl(rawRedisUrl);
  const explicitCacheProvider = cleanStringEnv(env.CACHE_PROVIDER)?.toLowerCase();

  if (explicitCacheProvider === 'redis' && rawRedisUrl && !hasValidRedisUrl) {
    throw new InfraConfigurationError(
      'INVALID_REDIS_URL',
      'REDIS_URL must be a valid redis:// or rediss:// connection URL when CACHE_PROVIDER=redis.'
    );
  }
  if (isProduction && topology === 'multi-instance' && rawRedisUrl && !hasValidRedisUrl) {
    throw new InfraConfigurationError(
      'INVALID_REDIS_URL',
      'REDIS_URL must be a valid redis:// or rediss:// connection URL in multi-instance production.'
    );
  }

  const redisUrl = hasValidRedisUrl ? rawRedisUrl : undefined;
  const rawCache = explicitCacheProvider || (redisUrl ? 'redis' : 'memory');
  const cacheProvider: CacheProviderName =
    rawCache === 'redis' || rawCache === 'memory'
      ? rawCache
      : (() => {
          throw new InfraConfigurationError(
            'INVALID_CACHE_PROVIDER',
            `Unsupported CACHE_PROVIDER "${env.CACHE_PROVIDER}". Expected "memory" or "redis".`
          );
        })();

  // 4. Email provider selection
  const resendApiKey = cleanStringEnv(env.RESEND_API_KEY);
  const smtpHost = cleanStringEnv(env.SMTP_HOST);
  const smtpUser = cleanStringEnv(env.SMTP_USER);
  const smtpPass = env.SMTP_PASS?.trim() || undefined;
  const explicitEmailProvider = cleanStringEnv(env.EMAIL_PROVIDER)?.toLowerCase();
  const rawEmail =
    explicitEmailProvider ||
    (isValidResendApiKey(resendApiKey)
      ? 'resend'
      : isValidSmtpHost(smtpHost) && smtpUser && smtpPass
      ? 'smtp'
      : 'none');
  const emailProvider: EmailProviderName =
    rawEmail === 'resend' || rawEmail === 'smtp' || rawEmail === 'none'
      ? rawEmail
      : (() => {
          throw new InfraConfigurationError(
            'INVALID_EMAIL_PROVIDER',
            `Unsupported EMAIL_PROVIDER "${env.EMAIL_PROVIDER}". Expected "none", "resend", or "smtp".`
          );
        })();

  // 5. Background jobs provider selection
  const rawJobs = (cleanStringEnv(env.JOBS_PROVIDER) || 'memory').toLowerCase();
  const jobsProvider: JobsProviderName =
    rawJobs === 'redis' || rawJobs === 'memory'
      ? rawJobs
      : (() => {
          throw new InfraConfigurationError(
            'INVALID_JOBS_PROVIDER',
            `Unsupported JOBS_PROVIDER "${env.JOBS_PROVIDER}". Expected "memory" or "redis".`
          );
        })();

  // 6. Logging selection
  const rawLogLevel = (cleanStringEnv(env.LOG_LEVEL) || (isProduction ? 'info' : 'debug')).toLowerCase();
  const logLevel: LogLevel =
    rawLogLevel === 'debug' || rawLogLevel === 'info' || rawLogLevel === 'warn' || rawLogLevel === 'error'
      ? rawLogLevel
      : 'info';
  const rawLogFormat = (cleanStringEnv(env.LOG_FORMAT) || 'json').toLowerCase();
  const logFormat: LogFormat = rawLogFormat === 'pretty' ? 'pretty' : 'json';

  const trustProxyRaw = env.TRUST_PROXY?.trim();
  const hasInjectedNumericStubs =
    isNumericStub(env.STORAGE_PROVIDER) ||
    isNumericStub(env.CACHE_PROVIDER) ||
    isNumericStub(env.EMAIL_PROVIDER) ||
    isNumericStub(env.DATABASE_URL) ||
    isNumericStub(env.DB_SOCKET_PATH);

  const safeNumericEnv = (value: string | undefined): string | undefined =>
    hasInjectedNumericStubs ? undefined : value;

  const trustProxy: number | boolean =
    trustProxyRaw === undefined || trustProxyRaw === '' || hasInjectedNumericStubs
      ? 1
      : trustProxyRaw === 'false'
      ? false
      : trustProxyRaw === 'true'
      ? true
      : parseIntSafe(trustProxyRaw, 1, 0, 10);

  const localStorageDir = cleanStringEnv(env.LOCAL_STORAGE_DIR);
  const s3Endpoint = cleanStringEnv(env.S3_ENDPOINT);
  const socketPath = isValidUnixSocketPath(env.DB_SOCKET_PATH) ? env.DB_SOCKET_PATH!.trim() : undefined;
  const sslCaCert = isValidCaCert(env.DB_SSL_CA_CERT) ? env.DB_SSL_CA_CERT!.trim() : undefined;

  const rawAllowedOrigins = cleanStringEnv(env.ALLOWED_ORIGINS);
  const allowedOrigins = rawAllowedOrigins
    ? rawAllowedOrigins
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('http://') || s.startsWith('https://'))
    : [];

  return {
    env: nodeEnv,
    isProduction,
    http: {
      port: parseIntSafe(env.PORT, 3000, 1, 65535),
      trustProxy,
      allowedOrigins,
    },
    storage: {
      provider: storageProvider,
      signedUrlMode,
      maxFileSizeBytes: parseIntSafe(
        safeNumericEnv(env.STORAGE_MAX_FILE_BYTES),
        8 * 1024 * 1024,
        64 * 1024,
        100 * 1024 * 1024
      ),
      local: {
        rootDir: path.resolve(localStorageDir || path.join(process.cwd(), 'storage', 'private')),
      },
      s3: {
        bucket: cleanStringEnv(env.S3_BUCKET) || '',
        region: cleanStringEnv(env.S3_REGION) || cleanStringEnv(env.AWS_REGION) || 'us-east-1',
        endpoint: s3Endpoint,
        accessKeyId: cleanStringEnv(env.S3_ACCESS_KEY_ID) || cleanStringEnv(env.AWS_ACCESS_KEY_ID),
        secretAccessKey:
          cleanStringEnv(env.S3_SECRET_ACCESS_KEY) || cleanStringEnv(env.AWS_SECRET_ACCESS_KEY),
        forcePathStyle: parseBool(env.S3_FORCE_PATH_STYLE, Boolean(s3Endpoint)),
        keyPrefix: normalizePrefix(env.S3_KEY_PREFIX),
      },
      gcs: {
        bucket: cleanStringEnv(env.GCS_BUCKET) || '',
        projectId: cleanStringEnv(env.GCS_PROJECT_ID) || cleanStringEnv(env.GOOGLE_CLOUD_PROJECT),
        keyFilename: cleanStringEnv(env.GCS_KEY_FILE) || cleanStringEnv(env.GOOGLE_APPLICATION_CREDENTIALS),
        keyPrefix: normalizePrefix(env.GCS_KEY_PREFIX),
      },
    },
    database: {
      connectionString: validDatabaseUrl,
      host: cleanStringEnv(env.SQL_HOST) || cleanStringEnv(env.PGHOST),
      port: parseIntSafe(safeNumericEnv(env.SQL_PORT) || safeNumericEnv(env.PGPORT), 5432, 1024, 65535),
      user: env.SQL_USER?.trim() || env.PGUSER?.trim() || undefined,
      password: env.SQL_PASSWORD || env.PGPASSWORD || undefined,
      database: env.SQL_DB_NAME?.trim() || env.PGDATABASE?.trim() || undefined,
      socketPath,
      sslMode,
      sslCaCert,
      poolMax: parseIntSafe(safeNumericEnv(env.DB_POOL_MAX), 10, 1, 100),
      idleTimeoutMillis: parseIntSafe(safeNumericEnv(env.DB_IDLE_TIMEOUT_MS), 30_000, 1000, 600_000),
      connectionTimeoutMillis: parseIntSafe(
        safeNumericEnv(env.DB_CONNECT_TIMEOUT_MS),
        15_000,
        1000,
        120_000
      ),
    },
    cache: {
      provider: cacheProvider,
      topology,
      allowInMemoryInProd: parseBool(env.ALLOW_IN_MEMORY_CACHE_IN_PROD, false),
      redisUrl,
      redisKeyPrefix: cleanStringEnv(env.REDIS_KEY_PREFIX) || 'ouro:',
      redisConnectTimeoutMs: parseIntSafe(
        safeNumericEnv(env.REDIS_CONNECT_TIMEOUT_MS),
        5000,
        500,
        60_000
      ),
    },
    email: {
      provider: emailProvider,
      fromAddress: cleanStringEnv(env.EMAIL_FROM) || 'OURO Platform <no-reply@ouro.local>',
      resendApiKey,
      smtp: {
        host: smtpHost,
        port: parseIntSafe(safeNumericEnv(env.SMTP_PORT), 587, 1, 65535),
        secure: parseBool(env.SMTP_SECURE, Number(safeNumericEnv(env.SMTP_PORT)) === 465),
        user: smtpUser,
        pass: smtpPass,
      },
    },
    jobs: {
      provider: jobsProvider,
      redisUrl,
      redisKeyPrefix: cleanStringEnv(env.JOBS_REDIS_PREFIX) || 'ouro:jobs:',
      defaultMaxAttempts: parseIntSafe(safeNumericEnv(env.JOBS_MAX_ATTEMPTS), 3, 1, 20),
      defaultBackoffMs: parseIntSafe(safeNumericEnv(env.JOBS_BACKOFF_MS), 500, 50, 60_000),
    },
    logging: {
      level: logLevel,
      format: logFormat,
      serviceName: cleanStringEnv(env.SERVICE_NAME) || 'ouro-api',
    },
  };
}

export interface EnvValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  config: InfraConfig;
}

/**
 * Validates security-critical environment configuration at startup.
 * In production (NODE_ENV=production), missing/weak signing secrets or missing DB config fail fast.
 * In development/staging, missing optional secrets emit warnings without blocking local workflow.
 */
export function validateEnvironmentConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { throwOnProductionError?: boolean } = {}
): EnvValidationResult {
  const config = resolveInfraConfig(env);
  const errors: string[] = [];
  const warnings: string[] = [];

  const sessionSecret = env.OURO_SESSION_SECRET?.trim() || '';
  const fileSignSecret = env.OURO_FILE_SIGN_SECRET?.trim() || '';
  const hasDbConfig = Boolean(
    config.database.connectionString || config.database.socketPath || config.database.host
  );

  if (!hasDbConfig) {
    errors.push('Database connectivity is unconfigured: set DATABASE_URL, DB_SOCKET_PATH, or SQL_HOST.');
  }

  if (config.isProduction) {
    if (sessionSecret.length < 32) {
      errors.push('OURO_SESSION_SECRET must be set and at least 32 characters in production.');
    }
    if (fileSignSecret.length < 32) {
      errors.push('OURO_FILE_SIGN_SECRET must be set and at least 32 characters in production.');
    }
    if (config.cache.topology === 'multi-instance' && config.cache.provider !== 'redis') {
      errors.push('Multi-instance production requires CACHE_PROVIDER=redis and a valid REDIS_URL.');
    }
    if (env.ALLOW_PILOT_SEED === 'true') {
      warnings.push('ALLOW_PILOT_SEED=true is set in production; disable after staging/pilot testing.');
    }
    if (config.database.sslMode === 'disable' && !config.database.socketPath) {
      warnings.push('DB_SSL is disabled over TCP in production; enable DB_SSL=require for cloud PostgreSQL.');
    }
    if (config.storage.provider === 'local') {
      warnings.push('STORAGE_PROVIDER=local in production; use s3 or gcs for multi-instance durability.');
    }
  } else {
    if (sessionSecret.length < 16) {
      warnings.push('OURO_SESSION_SECRET not set; using ephemeral per-process development signing key.');
    }
    if (fileSignSecret.length < 16) {
      warnings.push('OURO_FILE_SIGN_SECRET not set; using ephemeral per-process development file signing key.');
    }
  }

  if (options.throwOnProductionError && config.isProduction && errors.length > 0) {
    throw new InfraConfigurationError(
      'PRODUCTION_ENV_VALIDATION_FAILED',
      `Production environment validation failed: ${errors.join(' ')}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    config,
  };
}

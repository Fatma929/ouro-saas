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
  isPreviewRuntime: boolean;
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

const PREVIEW_APP_URL_PATTERN = /^https:\/\/ais-(dev|pre)-[a-z0-9-]+\.[a-z0-9.-]*run\.app(?:\/|$)/i;
const PREVIEW_K_SERVICE_PATTERN = /^ais-(dev|pre)-[a-z0-9-]+$/i;

/**
 * Positively identifies the hosted AI Studio Cloud Run preview runtime where
 * `.env.example` template keys may be auto-injected with bare numeric stub IDs.
 *
 * Strictly returns `false` whenever `NODE_ENV=production` or in standard local
 * development, test, staging, Docker, or cloud production environments.
 */
export function isPreviewRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = (env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production') {
    return false;
  }
  if (env.OURO_PREVIEW_RUNTIME?.trim().toLowerCase() === 'true') {
    return true;
  }
  const kService = (env.K_SERVICE || '').trim();
  if (PREVIEW_K_SERVICE_PATTERN.test(kService)) {
    return true;
  }
  const appUrl = (env.APP_URL || '').trim();
  if (PREVIEW_APP_URL_PATTERN.test(appUrl)) {
    return true;
  }
  return false;
}

function isBareNumericValue(value: string | undefined): boolean {
  return Boolean(value && /^\d+$/.test(value.trim()));
}

function parseBoolStrict(
  name: string,
  value: string | undefined,
  fallback: boolean,
  previewMode: boolean
): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const trimmed = value.trim();
  if (previewMode && isBareNumericValue(trimmed) && trimmed !== '0' && trimmed !== '1') {
    return fallback;
  }
  const normalized = trimmed.toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(normalized)) return true;
  if (['false', 'no', 'off', '0'].includes(normalized)) return false;
  throw new InfraConfigurationError(
    'INVALID_BOOLEAN_ENV',
    `Invalid boolean value "${value}" for ${name}. Expected "true" or "false".`
  );
}

function parseIntStrict(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new InfraConfigurationError(
      'INVALID_NUMERIC_ENV',
      `Invalid integer value "${value}" for ${name}. Expected an integer between ${min} and ${max}.`
    );
  }
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new InfraConfigurationError(
      'OUT_OF_RANGE_NUMERIC_ENV',
      `Value ${trimmed} for ${name} is out of allowed range [${min}, ${max}].`
    );
  }
  return n;
}

/**
 * Trims string env values. Strips bare numeric template placeholders ONLY when
 * running inside a positively identified non-production preview runtime.
 */
function readStringEnv(value: string | undefined, previewMode: boolean): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (previewMode && isBareNumericValue(trimmed)) return undefined;
  return trimmed;
}

function normalizePrefix(prefix: string | undefined, previewMode: boolean): string {
  const cleaned = readStringEnv(prefix, previewMode);
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
  if (/^\d+$/.test(trimmed) || /\s/.test(trimmed)) return false;
  return trimmed.includes('.') || trimmed.includes(':');
}

function isValidUnixSocketPath(value: string | undefined, previewMode: boolean): boolean {
  const cleaned = readStringEnv(value, previewMode);
  return Boolean(cleaned && cleaned.startsWith('/'));
}

function isValidCaCert(value: string | undefined, previewMode: boolean): boolean {
  const cleaned = readStringEnv(value, previewMode);
  if (!cleaned) return false;
  return cleaned.includes('BEGIN CERTIFICATE') || cleaned.startsWith('/') || cleaned.startsWith('./');
}

/**
 * Resolves all cloud-agnostic infrastructure configuration from process.env (or a supplied env map for testing).
 * Business modules read from these interfaces instead of branching on vendor-specific env vars.
 */
export function resolveInfraConfig(env: NodeJS.ProcessEnv = process.env): InfraConfig {
  const previewMode = isPreviewRuntime(env);
  const rawNodeEnv = (readStringEnv(env.NODE_ENV, previewMode) || 'development').toLowerCase();
  const isProduction = rawNodeEnv === 'production';

  // Only suppress injected numeric values for numeric fields if BOTH:
  // 1) We are positively inside the non-production AI Studio preview runtime, AND
  // 2) Known non-numeric provider/URL keys were actually injected with numeric stubs.
  const previewInjectedNumericStubs =
    previewMode &&
    (isBareNumericValue(env.STORAGE_PROVIDER) ||
      isBareNumericValue(env.CACHE_PROVIDER) ||
      isBareNumericValue(env.EMAIL_PROVIDER) ||
      isBareNumericValue(env.DATABASE_URL) ||
      isBareNumericValue(env.DB_SOCKET_PATH));

  const readNumericEnv = (value: string | undefined): string | undefined =>
    previewInjectedNumericStubs ? undefined : value;

  // 1. Storage provider selection (never silently falls back on invalid non-preview values)
  const explicitStorage = readStringEnv(env.STORAGE_PROVIDER, previewMode)?.toLowerCase();
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

  const rawSignedMode = (readStringEnv(env.STORAGE_SIGNED_URL_MODE, previewMode) || 'proxy').toLowerCase();
  if (rawSignedMode !== 'proxy' && rawSignedMode !== 'direct') {
    throw new InfraConfigurationError(
      'INVALID_STORAGE_SIGNED_URL_MODE',
      `Unsupported STORAGE_SIGNED_URL_MODE "${env.STORAGE_SIGNED_URL_MODE}". Expected "proxy" or "direct".`
    );
  }
  const signedUrlMode: StorageSignedUrlMode = rawSignedMode;

  // 2. Database configuration (supports 12-factor DATABASE_URL, Unix sockets, or discrete SQL_*/PG* vars)
  const rawSsl = (
    readStringEnv(env.DB_SSL, previewMode) ||
    readStringEnv(env.PGSSLMODE, previewMode) ||
    'disable'
  ).toLowerCase();
  const sslMode: DbSslMode =
    rawSsl === 'true' || rawSsl === 'require' || rawSsl === 'verify-full'
      ? 'require'
      : rawSsl === 'no-verify' || rawSsl === 'allow-self-signed'
      ? 'no-verify'
      : rawSsl === 'disable' || rawSsl === 'false'
      ? 'disable'
      : (() => {
          throw new InfraConfigurationError(
            'INVALID_DB_SSL_MODE',
            `Unsupported DB_SSL "${env.DB_SSL || env.PGSSLMODE}". Expected "disable", "require", or "no-verify".`
          );
        })();

  const rawDatabaseUrl = readStringEnv(env.DATABASE_URL, previewMode);
  if (rawDatabaseUrl && !isValidPostgresUrl(rawDatabaseUrl)) {
    throw new InfraConfigurationError(
      'INVALID_DATABASE_URL',
      'DATABASE_URL must be a valid postgres:// or postgresql:// connection URL.'
    );
  }
  const validDatabaseUrl = rawDatabaseUrl;

  // 3. Cache & Rate Limiting selection
  const explicitTopology = readStringEnv(env.DEPLOYMENT_TOPOLOGY, previewMode)?.toLowerCase();
  if (
    explicitTopology &&
    explicitTopology !== 'single-instance' &&
    explicitTopology !== 'multi-instance'
  ) {
    throw new InfraConfigurationError(
      'INVALID_DEPLOYMENT_TOPOLOGY',
      `Unsupported DEPLOYMENT_TOPOLOGY "${env.DEPLOYMENT_TOPOLOGY}". Expected "single-instance" or "multi-instance".`
    );
  }
  const topology: DeploymentTopology =
    explicitTopology === 'single-instance'
      ? 'single-instance'
      : explicitTopology === 'multi-instance'
      ? 'multi-instance'
      : isProduction
      ? 'multi-instance'
      : 'single-instance';

  const rawRedisUrl = readStringEnv(env.REDIS_URL, previewMode);
  const hasValidRedisUrl = isValidRedisUrl(rawRedisUrl);
  const explicitCacheProvider = readStringEnv(env.CACHE_PROVIDER, previewMode)?.toLowerCase();

  if (rawRedisUrl && !hasValidRedisUrl) {
    throw new InfraConfigurationError(
      'INVALID_REDIS_URL',
      'REDIS_URL must be a valid redis:// or rediss:// connection URL.'
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
  const resendApiKey = readStringEnv(env.RESEND_API_KEY, previewMode);
  const smtpHost = readStringEnv(env.SMTP_HOST, previewMode);
  const smtpUser = readStringEnv(env.SMTP_USER, previewMode);
  const smtpPass = env.SMTP_PASS?.trim() || undefined;
  const explicitEmailProvider = readStringEnv(env.EMAIL_PROVIDER, previewMode)?.toLowerCase();
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
  const rawJobs = (readStringEnv(env.JOBS_PROVIDER, previewMode) || 'memory').toLowerCase();
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
  const rawLogLevel = (
    readStringEnv(env.LOG_LEVEL, previewMode) || (isProduction ? 'info' : 'debug')
  ).toLowerCase();
  const logLevel: LogLevel =
    rawLogLevel === 'debug' || rawLogLevel === 'info' || rawLogLevel === 'warn' || rawLogLevel === 'error'
      ? rawLogLevel
      : 'info';
  const rawLogFormat = (readStringEnv(env.LOG_FORMAT, previewMode) || 'json').toLowerCase();
  const logFormat: LogFormat = rawLogFormat === 'pretty' ? 'pretty' : 'json';

  // 7. HTTP & Trust Proxy parsing (strict in all non-preview environments)
  const trustProxyRaw = readNumericEnv(env.TRUST_PROXY)?.trim();
  const trustProxy: number | boolean =
    trustProxyRaw === undefined || trustProxyRaw === ''
      ? 1
      : trustProxyRaw.toLowerCase() === 'false'
      ? false
      : trustProxyRaw.toLowerCase() === 'true'
      ? true
      : parseIntStrict('TRUST_PROXY', trustProxyRaw, 1, 0, 10);

  const localStorageDir = readStringEnv(env.LOCAL_STORAGE_DIR, previewMode);
  const s3Endpoint = readStringEnv(env.S3_ENDPOINT, previewMode);
  const socketPath = isValidUnixSocketPath(env.DB_SOCKET_PATH, previewMode)
    ? env.DB_SOCKET_PATH!.trim()
    : undefined;
  const sslCaCert = isValidCaCert(env.DB_SSL_CA_CERT, previewMode)
    ? env.DB_SSL_CA_CERT!.trim()
    : undefined;

  const rawAllowedOrigins = readStringEnv(env.ALLOWED_ORIGINS, previewMode);
  const allowedOrigins = rawAllowedOrigins
    ? rawAllowedOrigins
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('http://') || s.startsWith('https://'))
    : [];

  const smtpPort = parseIntStrict('SMTP_PORT', readNumericEnv(env.SMTP_PORT), 587, 1, 65535);

  return {
    env: rawNodeEnv,
    isProduction,
    isPreviewRuntime: previewMode,
    http: {
      port: parseIntStrict('PORT', env.PORT, 3000, 1, 65535),
      trustProxy,
      allowedOrigins,
    },
    storage: {
      provider: storageProvider,
      signedUrlMode,
      maxFileSizeBytes: parseIntStrict(
        'STORAGE_MAX_FILE_BYTES',
        readNumericEnv(env.STORAGE_MAX_FILE_BYTES),
        8 * 1024 * 1024,
        64 * 1024,
        100 * 1024 * 1024
      ),
      local: {
        rootDir: path.resolve(localStorageDir || path.join(process.cwd(), 'storage', 'private')),
      },
      s3: {
        bucket: readStringEnv(env.S3_BUCKET, previewMode) || '',
        region:
          readStringEnv(env.S3_REGION, previewMode) ||
          readStringEnv(env.AWS_REGION, previewMode) ||
          'us-east-1',
        endpoint: s3Endpoint,
        accessKeyId:
          readStringEnv(env.S3_ACCESS_KEY_ID, previewMode) ||
          readStringEnv(env.AWS_ACCESS_KEY_ID, previewMode),
        secretAccessKey:
          readStringEnv(env.S3_SECRET_ACCESS_KEY, previewMode) ||
          readStringEnv(env.AWS_SECRET_ACCESS_KEY, previewMode),
        forcePathStyle: parseBoolStrict(
          'S3_FORCE_PATH_STYLE',
          env.S3_FORCE_PATH_STYLE,
          Boolean(s3Endpoint),
          previewMode
        ),
        keyPrefix: normalizePrefix(env.S3_KEY_PREFIX, previewMode),
      },
      gcs: {
        bucket: readStringEnv(env.GCS_BUCKET, previewMode) || '',
        projectId:
          readStringEnv(env.GCS_PROJECT_ID, previewMode) ||
          readStringEnv(env.GOOGLE_CLOUD_PROJECT, previewMode),
        keyFilename:
          readStringEnv(env.GCS_KEY_FILE, previewMode) ||
          readStringEnv(env.GOOGLE_APPLICATION_CREDENTIALS, previewMode),
        keyPrefix: normalizePrefix(env.GCS_KEY_PREFIX, previewMode),
      },
    },
    database: {
      connectionString: validDatabaseUrl,
      host: readStringEnv(env.SQL_HOST, previewMode) || readStringEnv(env.PGHOST, previewMode),
      port: parseIntStrict(
        'SQL_PORT',
        readNumericEnv(env.SQL_PORT) || readNumericEnv(env.PGPORT),
        5432,
        1,
        65535
      ),
      user: env.SQL_USER?.trim() || env.PGUSER?.trim() || undefined,
      password: env.SQL_PASSWORD || env.PGPASSWORD || undefined,
      database: env.SQL_DB_NAME?.trim() || env.PGDATABASE?.trim() || undefined,
      socketPath,
      sslMode,
      sslCaCert,
      poolMax: parseIntStrict('DB_POOL_MAX', readNumericEnv(env.DB_POOL_MAX), 10, 1, 100),
      idleTimeoutMillis: parseIntStrict(
        'DB_IDLE_TIMEOUT_MS',
        readNumericEnv(env.DB_IDLE_TIMEOUT_MS),
        30_000,
        1000,
        600_000
      ),
      connectionTimeoutMillis: parseIntStrict(
        'DB_CONNECT_TIMEOUT_MS',
        readNumericEnv(env.DB_CONNECT_TIMEOUT_MS),
        15_000,
        500,
        120_000
      ),
    },
    cache: {
      provider: cacheProvider,
      topology,
      allowInMemoryInProd: parseBoolStrict(
        'ALLOW_IN_MEMORY_CACHE_IN_PROD',
        env.ALLOW_IN_MEMORY_CACHE_IN_PROD,
        false,
        previewMode
      ),
      redisUrl,
      redisKeyPrefix: readStringEnv(env.REDIS_KEY_PREFIX, previewMode) || 'ouro:',
      redisConnectTimeoutMs: parseIntStrict(
        'REDIS_CONNECT_TIMEOUT_MS',
        readNumericEnv(env.REDIS_CONNECT_TIMEOUT_MS),
        5000,
        500,
        60_000
      ),
    },
    email: {
      provider: emailProvider,
      fromAddress: readStringEnv(env.EMAIL_FROM, previewMode) || 'OURO Platform <no-reply@ouro.local>',
      resendApiKey,
      smtp: {
        host: smtpHost,
        port: smtpPort,
        secure: parseBoolStrict('SMTP_SECURE', env.SMTP_SECURE, smtpPort === 465, previewMode),
        user: smtpUser,
        pass: smtpPass,
      },
    },
    jobs: {
      provider: jobsProvider,
      redisUrl,
      redisKeyPrefix: readStringEnv(env.JOBS_REDIS_PREFIX, previewMode) || 'ouro:jobs:',
      defaultMaxAttempts: parseIntStrict(
        'JOBS_MAX_ATTEMPTS',
        readNumericEnv(env.JOBS_MAX_ATTEMPTS),
        3,
        1,
        20
      ),
      defaultBackoffMs: parseIntStrict(
        'JOBS_BACKOFF_MS',
        readNumericEnv(env.JOBS_BACKOFF_MS),
        500,
        50,
        60_000
      ),
    },
    logging: {
      level: logLevel,
      format: logFormat,
      serviceName: readStringEnv(env.SERVICE_NAME, previewMode) || 'ouro-api',
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
 * In production (NODE_ENV=production), missing/weak signing secrets, invalid providers,
 * missing DB config, or missing Redis in multi-instance topology fail fast.
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

  if (config.storage.provider === 's3' && !config.storage.s3.bucket) {
    errors.push('S3_BUCKET is required when STORAGE_PROVIDER=s3.');
  }
  if (config.storage.provider === 'gcs' && !config.storage.gcs.bucket) {
    errors.push('GCS_BUCKET is required when STORAGE_PROVIDER=gcs.');
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
    if (config.cache.provider === 'redis' && !config.cache.redisUrl) {
      errors.push('REDIS_URL is required when CACHE_PROVIDER=redis.');
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
